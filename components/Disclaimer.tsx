"use client";

import { useEffect, useState } from "react";

/**
 * First-run, blocking disclaimer. The app talks to Bambu's cloud with
 * undocumented APIs and can send print commands, so the first visit makes the
 * unofficial status explicit. The acknowledgement is kept only in this
 * browser's localStorage — nothing about it reaches the server.
 */

const KEY = "bhw_ack_v1";

export default function Disclaimer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true); // storage blocked (private mode): show it each visit, that's fine.
    }
  }, []);

  if (!open) return null;

  function accept() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal stack" role="dialog" aria-modal="true" aria-labelledby="disc-title">
        <h2 id="disc-title" style={{ margin: 0 }}>
          Before you start
        </h2>
        <p style={{ margin: 0 }}>
          <strong>Bambu Web Remote is unofficial.</strong> It’s an independent, open-source project — not affiliated
          with, endorsed by, or supported by Bambu Lab. It uses undocumented APIs that can change or break at any time.
        </p>
        <ul className="plain-list">
          <li>Your Bambu login goes straight to Bambu’s own servers. Nothing is stored here.</li>
          <li>Live status works on any printer. Starting prints only works where the firmware still accepts third-party commands.</li>
          <li>Sending a print is experimental. Stay near the printer the first time you use it.</li>
        </ul>
        <p className="small muted" style={{ margin: 0 }}>
          “Bambu Lab”, “Bambu Handy” and “MakerWorld” are trademarks of their respective owners.{" "}
          <a href="/privacy">How your data flows.</a>
        </p>
        <div className="row">
          <span className="spacer" />
          <button className="btn btn-primary" type="button" onClick={accept} autoFocus>
            I understand — continue
          </button>
        </div>
      </div>
    </div>
  );
}
