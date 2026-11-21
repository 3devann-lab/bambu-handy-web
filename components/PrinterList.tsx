"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, formatDuration } from "@/lib/client";
import type { PrinterSummary } from "@/lib/types";

const REFRESH_MS = 30_000;

function statusBadge(p: PrinterSummary): { tone: string; label: string } {
  if (!p.online) return { tone: "dim", label: "Offline" };
  const s = (p.task?.status || p.printStatus || "").toUpperCase();
  if (s === "RUNNING" || s === "PRINTING") return { tone: "info", label: "Printing" };
  if (s === "PAUSE" || s === "PAUSED") return { tone: "warn", label: "Paused" };
  if (s === "PREPARE" || s === "SLICING") return { tone: "info", label: "Preparing" };
  if (s === "FAILED") return { tone: "bad", label: "Failed" };
  if (s === "FINISH" || s === "SUCCESS") return { tone: "ok", label: "Idle · last print finished" };
  return { tone: "ok", label: "Idle" };
}

function isActive(p: PrinterSummary) {
  const s = (p.task?.status || p.printStatus || "").toUpperCase();
  return p.online && ["RUNNING", "PRINTING", "PAUSE", "PAUSED", "PREPARE"].includes(s);
}

export default function PrinterList() {
  const [printers, setPrinters] = useState<PrinterSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { printers } = await api<{ printers: PrinterSummary[] }>("/api/printers");
      setPrinters(printers);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Couldn't load printers.", 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // Skip refreshes while the tab is hidden to save Bambu (and Vercel) calls.
      if (document.visibilityState === "visible") await load();
      if (!cancelled) timer.current = setTimeout(tick, REFRESH_MS);
    };
    tick();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Your printers</h1>
        <span className="spacer" />
        {updatedAt && (
          <span className="muted small" aria-live="polite">
            Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button className="btn" type="button" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="alert bad" role="alert">
          <h2>{error.code === "UPSTREAM_BLOCKED" ? "Bambu refused the request" : "Couldn't load printers"}</h2>
          <p>{error.message}</p>
        </div>
      )}

      {printers === null && !error && (
        <div className="grid" aria-busy="true" aria-label="Loading printers">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {printers?.length === 0 && (
        <div className="card">
          <h2>No printers on this account</h2>
          <p className="muted">
            Bind a printer to your Bambu Lab account with Bambu Handy or Bambu Studio, then refresh this page.
          </p>
        </div>
      )}

      {printers && printers.length > 0 && (
        <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {printers.map((p) => {
            const badge = statusBadge(p);
            const active = isActive(p);
            const progress = p.task?.progress ?? null;
            return (
              <li key={p.id}>
                <a className="card printer-card" href={`/printers/${encodeURIComponent(p.id)}`} aria-labelledby={`p-${p.id}`}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    {active && p.task?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={p.task.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 id={`p-${p.id}`}>{p.name}</h2>
                      <p className="muted small" style={{ margin: "2px 0 8px" }}>
                        {p.modelName}
                        {p.nozzleDiameter ? ` · ${p.nozzleDiameter} mm nozzle` : ""}
                      </p>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    </div>
                  </div>

                  {active && (
                    <div className="stack" style={{ marginTop: 0 }}>
                      <p style={{ margin: 0, fontWeight: 700, overflowWrap: "anywhere" }}>{p.task?.name || "Current job"}</p>
                      {progress != null && (
                        <>
                          <div
                            className="progress"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                            aria-label="Print progress"
                          >
                            <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                          </div>
                          <dl className="kv">
                            <dt>Progress</dt>
                            <dd>{progress}%</dd>
                            {p.task?.predictionS != null && (
                              <>
                                <dt>Estimated total</dt>
                                <dd>{formatDuration(p.task.predictionS)}</dd>
                              </>
                            )}
                          </dl>
                        </>
                      )}
                    </div>
                  )}

                  {!p.online && (
                    <p className="muted small" style={{ margin: 0 }}>
                      This printer isn&apos;t connected to Bambu&apos;s cloud. Check its power and Wi-Fi. Printers in
                      LAN-only mode can&apos;t be reached from here.
                    </p>
                  )}
                  <p className="open-hint">View live status →</p>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted small">
        This list refreshes every 30 seconds. Open a printer for live progress, layers, temperatures, AMS trays
        and errors.
      </p>
    </div>
  );
}
