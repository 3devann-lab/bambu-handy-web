"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/client";
import { SPEED_LABELS, type PrinterStatus } from "@/lib/status";

interface ControlReply {
  acknowledged: boolean;
  control: "allowed" | "blocked" | "unknown";
}

type Action = "pause" | "resume" | "stop" | "speed" | "light";

export default function PrinterControls({
  deviceId,
  status,
  lightOn,
  onChanged,
}: {
  deviceId: string;
  status: PrinterStatus;
  lightOn: boolean | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  if (status.control === "blocked") {
    // PrinterDetail already explains the firmware limit; keep this area quiet.
    return null;
  }

  async function send(action: Action, body: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    try {
      const r = await api<ControlReply>(`/api/printers/${encodeURIComponent(deviceId)}/control`, {
        body: { action, ...body },
      });
      if (r.control === "blocked") {
        setError("The printer rejected the command — its firmware requires Bambu-signed commands.");
      }
      // Re-read live status either way so the UI reflects the real state.
      setTimeout(onChanged, 800);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t send the command.");
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  const printing = status.state === "printing" || status.state === "preparing";
  const paused = status.state === "paused";
  const active = printing || paused;

  return (
    <section className="card stack" aria-labelledby="ctl-head">
      <div className="row">
        <h2 id="ctl-head" style={{ margin: 0 }}>
          Controls
        </h2>
        {status.control === "unknown" && (
          <span className="badge dim" title="Firmware rules couldn’t be confirmed">
            Unverified
          </span>
        )}
      </div>

      {error && (
        <div className="alert bad" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="ctl-grid">
        {paused ? (
          <button className="btn btn-primary" type="button" disabled={busy !== null} onClick={() => send("resume", {})}>
            {busy === "resume" ? "Resuming…" : "Resume"}
          </button>
        ) : (
          <button
            className="btn"
            type="button"
            disabled={busy !== null || !printing}
            onClick={() => send("pause", {})}
          >
            {busy === "pause" ? "Pausing…" : "Pause"}
          </button>
        )}

        {confirmStop ? (
          <button className="btn btn-danger" type="button" disabled={busy !== null} onClick={() => send("stop", {})}>
            {busy === "stop" ? "Stopping…" : "Tap again to stop"}
          </button>
        ) : (
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy !== null || !active}
            onClick={() => setConfirmStop(true)}
          >
            Stop
          </button>
        )}

        {lightOn !== null && (
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            aria-pressed={lightOn}
            onClick={() => send("light", { on: !lightOn })}
          >
            {busy === "light" ? "…" : lightOn ? "Light off" : "Light on"}
          </button>
        )}
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="ctl-speed">Print speed</label>
        <div className="segmented" role="group" aria-label="Print speed">
          {[1, 2, 3, 4].map((lvl) => (
            <button
              key={lvl}
              type="button"
              aria-pressed={status.speedLevel === lvl}
              disabled={busy !== null || !active}
              onClick={() => send("speed", { level: lvl })}
            >
              {SPEED_LABELS[lvl]}
            </button>
          ))}
        </div>
        {!active && <span className="hint">Speed can be changed while a job is running.</span>}
      </div>
    </section>
  );
}
