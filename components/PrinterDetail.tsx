"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatDuration } from "@/lib/client";
import { SPEED_LABELS, parseStatus, type JobState, type Tray } from "@/lib/status";
import type { PrinterSummary } from "@/lib/types";
import { useLiveStatus } from "@/lib/useLiveStatus";
import PrinterControls from "@/components/PrinterControls";

const STATE_UI: Record<JobState, { tone: string; label: string }> = {
  idle: { tone: "ok", label: "Idle" },
  preparing: { tone: "info", label: "Preparing" },
  printing: { tone: "info", label: "Printing" },
  paused: { tone: "warn", label: "Paused" },
  finished: { tone: "ok", label: "Finished" },
  failed: { tone: "bad", label: "Failed" },
  offline: { tone: "dim", label: "Offline" },
  unknown: { tone: "dim", label: "Unknown" },
};

const SEVERITY_TONE: Record<string, string> = { fatal: "bad", serious: "bad", common: "warn", info: "info", unknown: "warn" };

function temp(v: number | null) {
  return v == null ? "–" : `${Math.round(v)}°C`;
}

function TrayChip({ tray, label }: { tray: Tray; label: string }) {
  const swatch =
    tray.colors.length > 1
      ? `conic-gradient(${tray.colors.map((c, i) => `${c} ${(i / tray.colors.length) * 360}deg ${((i + 1) / tray.colors.length) * 360}deg`).join(",")})`
      : (tray.color ?? "transparent");
  return (
    <li className={`tray${tray.active ? " tray-active" : ""}${tray.empty ? " tray-empty" : ""}`}>
      <span className="tray-swatch" style={{ background: tray.empty ? undefined : swatch }} aria-hidden="true" />
      <span className="tray-text">
        <strong>{label}</strong>
        <span>{tray.empty ? "Empty" : tray.name || tray.type || "Unknown"}</span>
        {!tray.empty && (
          <span className="muted small">
            {tray.type}
            {tray.remain != null ? ` · ${tray.remain}% left` : ""}
            {tray.color ? ` · ${tray.color.toUpperCase()}` : ""}
          </span>
        )}
        {tray.active && <span className="badge info">In use</span>}
      </span>
    </li>
  );
}

export default function PrinterDetail({ id }: { id: string }) {
  const live = useLiveStatus(id);
  const [summary, setSummary] = useState<PrinterSummary | null>(null);
  const status = useMemo(() => (live.raw ? parseStatus(live.raw) : null), [live.raw]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api<{ printers: PrinterSummary[] }>("/api/printers")
      .then((r) => setSummary(r.printers.find((p) => p.id === id) ?? null))
      .catch(() => null);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [id]);

  const offline = summary ? !summary.online : false;
  const stateUi = offline ? STATE_UI.offline : status ? STATE_UI[status.state] : null;
  const active = status && ["printing", "paused", "preparing"].includes(status.state);
  const eta =
    status?.remainingMin != null && active ? new Date(now + status.remainingMin * 60_000) : null;
  const pct = Math.max(0, Math.min(100, status?.percent ?? 0));
  const severe = Boolean(status?.printError) || Boolean(status?.hms.some((h) => h.severity === "fatal" || h.severity === "serious"));
  const ageS = live.lastReportAt ? Math.round((now - live.lastReportAt) / 1000) : null;

  return (
    <div className="stack">
      <a className="btn btn-ghost" href="/printers" style={{ alignSelf: "flex-start" }}>
        ← All printers
      </a>

      <div className="row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ marginBottom: 4 }}>{summary?.name ?? "Printer"}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {summary?.modelName ?? ""}
            {summary?.nozzleDiameter ? ` · ${summary.nozzleDiameter} mm nozzle` : ""}
          </p>
        </div>
        {stateUi && <span className={`badge ${stateUi.tone}`}>{stateUi.label}</span>}
        <button className="btn" type="button" onClick={live.refresh} disabled={live.loading}>
          {live.loading ? "Updating…" : "Refresh"}
        </button>
      </div>

      <p className="muted small" aria-live="polite" style={{ margin: 0 }}>
        {live.lastReportAt
          ? `Live · last report ${ageS != null && ageS < 10 ? "just now" : `${ageS}s ago`}`
          : live.loading
            ? "Connecting to the printer…"
            : ""}
      </p>

      {live.error && (
        <div className="alert bad" role="alert">
          <h2>Live status unavailable</h2>
          <p>{live.error.message}</p>
        </div>
      )}

      {offline && (
        <div className="alert warn" role="status">
          <h2>Printer offline</h2>
          <p>
            Bambu&apos;s cloud says this printer isn&apos;t connected. Check that it&apos;s powered on and on Wi-Fi,
            and that it isn&apos;t in LAN-only mode.
          </p>
        </div>
      )}

      {!offline && live.noResponse && !live.error && (
        <div className="alert warn" role="status">
          <h2>No response from the printer</h2>
          <p>We asked for a status update but heard nothing back. The printer may be offline or asleep. We&apos;ll keep trying.</p>
        </div>
      )}

      {!status && !live.error && !live.noResponse && !offline && (
        <div className="grid" aria-busy="true" aria-label="Loading live status">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {status && (
        <>
          {(status.printError || status.hms.length > 0) && (
            <section className={`alert ${severe ? "bad" : "warn"}`} aria-labelledby="errors-h">
              <h2 id="errors-h">Printer needs attention</h2>
              <ul className="plain-list">
                {status.printError && (
                  <li>
                    Print error <code>{status.printError}</code>
                  </li>
                )}
                {status.hms.map((h) => (
                  <li key={h.code} className="row">
                    <span className={`badge ${SEVERITY_TONE[h.severity]}`}>{h.severity}</span>
                    <code>HMS_{h.code}</code>
                  </li>
                ))}
              </ul>
              <p className="small">
                Look up these codes on the{" "}
                <a href="https://wiki.bambulab.com/en/hms/home" target="_blank" rel="noreferrer noopener">
                  Bambu Lab wiki HMS page
                </a>
                . Clear the error on the printer&apos;s screen once it&apos;s fixed.
              </p>
            </section>
          )}

          {status.control === "blocked" && (
            <section className="alert info" aria-labelledby="ctl-h">
              <h3 id="ctl-h">Firmware limits third-party control</h3>
              <p>
                Live monitoring works. This printer&apos;s firmware only accepts print commands signed by Bambu&apos;s own
                apps, so starting or stopping prints from this site isn&apos;t possible. Use Bambu Handy or Bambu Studio
                for that. <a href="/privacy#firmware">Why?</a>
              </p>
            </section>
          )}

          {!offline && (
            <PrinterControls
              deviceId={id}
              status={status}
              lightOn={status.chamberLight}
              onChanged={live.refresh}
            />
          )}

          <div className="grid">
            <section className="card stack" aria-labelledby="job-h">
              <h2 id="job-h">Current job</h2>
              {active || status.state === "finished" || status.state === "failed" ? (
                <>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    {summary?.task?.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb-lg" src={summary.task.thumbnail} alt="Job preview" referrerPolicy="no-referrer" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, overflowWrap: "anywhere", margin: 0 }}>{status.jobName || "Untitled"}</p>
                      <p className="big-number" aria-label={`${pct} percent complete`}>
                        {pct}%
                      </p>
                    </div>
                  </div>
                  <div
                    className="progress progress-lg"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-label="Print progress"
                  >
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <dl className="kv">
                    <dt>Layer</dt>
                    <dd>
                      {status.layer ?? "–"} / {status.totalLayers ?? "–"}
                    </dd>
                    {active && (
                      <>
                        <dt>Time left</dt>
                        <dd>{formatDuration(status.remainingMin != null ? status.remainingMin * 60 : null)}</dd>
                        <dt>Done at</dt>
                        <dd>{eta ? eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"}</dd>
                      </>
                    )}
                    {status.speedLevel != null && (
                      <>
                        <dt>Speed</dt>
                        <dd>{SPEED_LABELS[status.speedLevel] ?? status.speedLevel}</dd>
                      </>
                    )}
                  </dl>
                </>
              ) : (
                <div className="stack">
                  <p className="muted" style={{ margin: 0 }}>Nothing is printing right now.</p>
                  <a className="btn btn-primary" href="/makerworld" style={{ alignSelf: "flex-start" }}>
                    Browse MakerWorld to print
                  </a>
                </div>
              )}
            </section>

            <section className="card stack" aria-labelledby="temps-h">
              <h2 id="temps-h">Temperatures</h2>
              <dl className="temps">
                <div>
                  <dt>Nozzle</dt>
                  <dd>{temp(status.nozzle.temp)}</dd>
                  <dd className="muted small">target {temp(status.nozzle.target)}</dd>
                </div>
                <div>
                  <dt>Bed</dt>
                  <dd>{temp(status.bed.temp)}</dd>
                  <dd className="muted small">target {temp(status.bed.target)}</dd>
                </div>
                {status.chamber != null && status.chamber > 0 && (
                  <div>
                    <dt>Chamber</dt>
                    <dd>{temp(status.chamber)}</dd>
                  </div>
                )}
              </dl>
              {status.hasCamera && (
                <p className="muted small" style={{ margin: 0 }}>
                  Live camera isn&apos;t available here: Bambu streams video over native P2P software that browsers
                  can&apos;t run.
                </p>
              )}
            </section>
          </div>

          <section className="card stack" aria-labelledby="ams-h">
            <h2 id="ams-h">Filament</h2>
            {status.ams.length === 0 && <p className="muted">No AMS detected.</p>}
            {status.ams.map((unit) => (
              <div key={unit.id} className="stack">
                <h3 style={{ margin: 0 }}>
                  AMS {String.fromCharCode(65 + (unit.id % 26))}
                  {unit.humidity != null && <span className="muted small"> · humidity level {unit.humidity}</span>}
                  {unit.tempC != null && unit.tempC > 0 && <span className="muted small"> · {temp(unit.tempC)}</span>}
                </h3>
                <ul className="trays">
                  {unit.trays.map((t) => (
                    <TrayChip key={t.index} tray={t} label={`${String.fromCharCode(65 + (unit.id % 26))}${t.slot + 1}`} />
                  ))}
                </ul>
              </div>
            ))}
            {status.externalSpool && (
              <div className="stack">
                <h3 style={{ margin: 0 }}>External spool</h3>
                <ul className="trays">
                  <TrayChip tray={status.externalSpool} label="Ext" />
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
