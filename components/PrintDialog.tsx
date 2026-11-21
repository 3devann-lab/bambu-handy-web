"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, formatDuration } from "@/lib/client";
import type { DesignDetail, Instance, Plate } from "@/lib/makerworld";
import { EXTERNAL_SPOOL, buildAmsMapping, validateAmsMapping, type MapWarning } from "@/lib/print";
import type { AmsUnit, Tray } from "@/lib/status";
import type { PrinterSummary } from "@/lib/types";

type ControlAccess = "allowed" | "blocked" | "unknown";

interface Preflight {
  control: ControlAccess;
  reportSeen: boolean;
  state: string | null;
  ams: AmsUnit[];
  externalSpool: Tray | null;
}

interface StartResult {
  taskId: string;
  acknowledged: boolean;
  control: ControlAccess;
}

const BAMBU_STUDIO_HELP = "https://wiki.bambulab.com/en/software/bambu-studio/open-3mf-from-makerworld";

function amsLetter(id: number): string {
  return String.fromCharCode(65 + (id % 26));
}

interface Selectable {
  index: number;
  label: string;
  type: string;
  color: string | null;
  empty: boolean;
}

function selectableTrays(pf: Preflight | null): Selectable[] {
  if (!pf) return [];
  const out: Selectable[] = [];
  for (const unit of pf.ams) {
    for (const t of unit.trays) {
      out.push({
        index: t.index,
        label: `${amsLetter(unit.id)}${t.slot + 1} · ${t.empty ? "Empty" : t.name || t.type}`,
        type: t.type,
        color: t.color,
        empty: t.empty,
      });
    }
  }
  if (pf.externalSpool) {
    out.push({
      index: EXTERNAL_SPOOL,
      label: `External spool · ${pf.externalSpool.empty ? "Empty" : pf.externalSpool.name || pf.externalSpool.type}`,
      type: pf.externalSpool.type,
      color: pf.externalSpool.color,
      empty: pf.externalSpool.empty,
    });
  } else {
    out.push({ index: EXTERNAL_SPOOL, label: "External spool", type: "", color: null, empty: true });
  }
  return out;
}

/** Best-guess tray for a filament: same type, then closest color. */
function autoAssign(plate: Plate, trays: Selectable[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const f of plate.filaments) {
    const sameType = trays.filter((t) => !t.empty && t.type.toUpperCase() === f.type.toUpperCase());
    const pick = sameType.find((t) => t.color && f.color && t.color === f.color) ?? sameType[0];
    if (pick) out[f.slot] = pick.index;
  }
  return out;
}

function swatch(color: string | null) {
  return (
    <span
      className="fil-dot"
      aria-hidden="true"
      style={{ background: color ?? "transparent", borderStyle: color ? "solid" : "dashed" }}
    />
  );
}

export default function PrintDialog({
  design,
  instance,
  printers,
  onClose,
}: {
  design: DesignDetail;
  instance: Instance;
  printers: PrinterSummary[];
  onClose: () => void;
}) {
  const [printerId, setPrinterId] = useState(printers[0]?.id ?? "");
  const [plateIndex, setPlateIndex] = useState(instance.plates[0]?.index ?? 1);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [pfError, setPfError] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(false);
  const [assignment, setAssignment] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const plate = useMemo(
    () => instance.plates.find((p) => p.index === plateIndex) ?? instance.plates[0] ?? null,
    [instance.plates, plateIndex],
  );
  const printer = printers.find((p) => p.id === printerId) ?? null;
  const trays = useMemo(() => selectableTrays(pf), [pf]);

  // Pre-flight the chosen printer: read firmware flags + current AMS trays.
  const runPreflight = useCallback(async (id: string) => {
    if (!id) return;
    setChecking(true);
    setPfError(null);
    setPf(null);
    try {
      const r = await api<Preflight>(`/api/printers/${encodeURIComponent(id)}/print`);
      setPf(r);
    } catch (e) {
      setPfError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Couldn’t reach the printer.", 0));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    runPreflight(printerId);
  }, [printerId, runPreflight]);

  // Auto-assign trays once we know both the plate and the loaded filaments.
  useEffect(() => {
    if (pf && plate) setAssignment(autoAssign(plate, selectableTrays(pf)));
  }, [pf, plate]);

  // Esc closes; focus the dialog on open.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const warnings: MapWarning[] = useMemo(() => {
    if (!plate) return [];
    const mapTrays = trays.map((t) => ({ index: t.index, empty: t.empty, type: t.type }));
    return validateAmsMapping(
      plate.filaments.map((f) => ({ slot: f.slot, type: f.type })),
      mapTrays,
      assignment,
    );
  }, [plate, trays, assignment]);

  const blocked = pf?.control === "blocked";
  const hasErrors = warnings.some((w) => w.severity === "error");
  const allAssigned = plate ? plate.filaments.every((f) => Number.isInteger(assignment[f.slot])) : false;
  const canSubmit = !blocked && !checking && !submitting && !!printer && !!plate && allAssigned && !hasErrors;

  async function submit() {
    if (!printer || !plate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const mapping = buildAmsMapping(
        plate.filaments.map((f) => ({ slot: f.slot, type: f.type })),
        assignment,
      );
      const r = await api<StartResult>(`/api/printers/${encodeURIComponent(printer.id)}/print`, {
        body: {
          modelId: design.modelId,
          profileId: instance.profileId,
          plateIndex: plate.index,
          title: `${design.title} — ${instance.title}`.slice(0, 120),
          cover: plate.thumbnail ?? instance.cover ?? design.cover,
          mapping,
        },
      });
      setResult(r);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Couldn’t start the print.", 0));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2 id="pd-title" style={{ margin: 0 }}>
            Print this profile
          </h2>
          <span className="spacer" />
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          {design.title} — {instance.title} · {formatDuration(plate?.prediction ?? instance.prediction)}
        </p>

        {result ? (
          <ResultView result={result} printerName={printer?.name ?? "your printer"} onClose={onClose} />
        ) : (
          <>
            {printers.length > 1 && (
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="pd-printer">Printer</label>
                <select id="pd-printer" value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.modelName})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {instance.plates.length > 1 && (
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="pd-plate">Plate</label>
                <select id="pd-plate" value={plateIndex} onChange={(e) => setPlateIndex(Number(e.target.value))}>
                  {instance.plates.map((p) => (
                    <option key={p.index} value={p.index}>
                      Plate {p.index}
                      {p.name ? ` · ${p.name}` : ""} ({formatDuration(p.prediction)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {checking && <p className="muted" aria-live="polite">Checking the printer…</p>}

            {pfError && (
              <div className="alert bad" role="alert">
                <p style={{ margin: 0 }}>{pfError.message}</p>
              </div>
            )}

            {pf && !pf.reportSeen && (
              <div className="alert warn" role="status">
                <p style={{ margin: 0 }}>
                  The printer didn’t answer a status request, so its firmware rules and loaded filament are unknown.
                  It may be offline or asleep.
                </p>
              </div>
            )}

            {blocked ? (
              <FirmwareBlocked design={design} />
            ) : (
              pf &&
              plate && (
                <>
                  {pf.control === "unknown" && pf.reportSeen && (
                    <div className="alert warn">
                      <p style={{ margin: 0 }}>
                        Couldn’t confirm this printer’s firmware rules. The print may be rejected if it requires signed
                        commands.
                      </p>
                    </div>
                  )}

                  <fieldset className="pd-map">
                    <legend>Match filament to trays</legend>
                    {plate.filaments.map((f) => (
                      <div className="pd-slot" key={f.slot}>
                        <span className="pd-slot-label">
                          {swatch(f.color)}
                          <span>
                            Slot {f.slot} · <strong>{f.type}</strong>
                            {f.color ? ` ${f.color.toUpperCase()}` : ""}
                          </span>
                        </span>
                        <select
                          aria-label={`Tray for slot ${f.slot}`}
                          value={assignment[f.slot] ?? ""}
                          onChange={(e) =>
                            setAssignment((a) => ({ ...a, [f.slot]: Number(e.target.value) }))
                          }
                        >
                          <option value="">Choose a tray…</option>
                          {trays.map((t) => (
                            <option key={t.index} value={t.index} disabled={t.empty && t.index !== EXTERNAL_SPOOL}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </fieldset>

                  {warnings.length > 0 && (
                    <div className={`alert ${hasErrors ? "bad" : "warn"}`}>
                      <ul className="plain-list" style={{ marginBottom: 0 }}>
                        {warnings.map((w, i) => (
                          <li key={i}>{w.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="alert info">
                    <p style={{ margin: 0 }}>
                      <strong>Experimental &amp; unofficial.</strong> This sends an unsigned cloud command. It only
                      works on printers whose firmware still accepts third-party commands, and it hasn’t been verified
                      on every model. Stay near the printer when it starts.
                    </p>
                  </div>

                  {submitError && (
                    <div className="alert bad" role="alert">
                      <p style={{ margin: 0 }}>{submitError.message}</p>
                    </div>
                  )}

                  <div className="row">
                    <button className="btn btn-ghost" type="button" onClick={onClose}>
                      Cancel
                    </button>
                    <span className="spacer" />
                    <button className="btn btn-primary" type="button" onClick={submit} disabled={!canSubmit}>
                      {submitting ? "Sending…" : "Start print"}
                    </button>
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FirmwareBlocked({ design }: { design: DesignDetail }) {
  return (
    <div className="alert info stack">
      <h3 style={{ margin: 0 }}>This printer’s firmware blocks third-party printing</h3>
      <p style={{ margin: 0 }}>
        Since 2025, Bambu firmware only accepts print commands signed by Bambu’s own apps. This project won’t forge
        that signature, so it can’t start the job here. You can still:
      </p>
      <ul className="plain-list" style={{ margin: 0 }}>
        <li>
          <a href={`https://makerworld.com/en/models/${design.id}`} target="_blank" rel="noreferrer noopener">
            Open the model on MakerWorld ↗
          </a>{" "}
          and use its “Print” / “Open in Bambu Studio” button.
        </li>
        <li>Start the job from Bambu Handy or Bambu Studio on another device.</li>
        <li>
          <a href={BAMBU_STUDIO_HELP} target="_blank" rel="noreferrer noopener">
            How “Open in Bambu Studio” works ↗
          </a>
        </li>
      </ul>
      <p className="small" style={{ margin: 0 }}>
        <a href="/privacy#firmware">Why this limit exists.</a>
      </p>
    </div>
  );
}

function ResultView({
  result,
  printerName,
  onClose,
}: {
  result: StartResult;
  printerName: string;
  onClose: () => void;
}) {
  return (
    <div className="stack">
      <div className="alert info">
        <h3 style={{ marginTop: 0 }}>Print command sent to {printerName}</h3>
        <p style={{ margin: 0 }}>
          {result.acknowledged
            ? "The printer acknowledged the command."
            : "The command was sent. Open the printer to confirm it starts — if nothing happens in a minute, its firmware may have rejected it."}
        </p>
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Close
        </button>
        <a className="btn btn-primary" href="/printers">
          Watch printers
        </a>
      </div>
    </div>
  );
}
