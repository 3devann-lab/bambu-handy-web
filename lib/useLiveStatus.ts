"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./client";
import { isFullSnapshot, mergeReport, type RawPrint } from "./status";

/**
 * Client-side half of live status. The server is stateless, so the merged
 * printer state lives here and each poll's delta is merged in.
 *
 * Cadence (API_NOTES.md §3.3):
 *  - a full snapshot (`pushall`) on open, after errors, and every 5 min;
 *  - otherwise short "listen" polls (~3 s server-side window) every few seconds
 *    while printing, slower while idle;
 *  - nothing at all while the tab is hidden.
 */

const FULL_EVERY_MS = 5 * 60_000;
const GAP_ACTIVE_MS = 4_000;
const GAP_IDLE_MS = 20_000;

interface StatusReply {
  print: RawPrint;
  messages: number;
  full: boolean;
  at: number;
}

export interface LiveStatus {
  raw: RawPrint | null;
  /** Last time any report arrived from the printer. */
  lastReportAt: number | null;
  /** True when the last full snapshot request got no answer at all. */
  noResponse: boolean;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
}

export function useLiveStatus(deviceId: string): LiveStatus {
  const [raw, setRaw] = useState<RawPrint | null>(null);
  const [lastReportAt, setLastReportAt] = useState<number | null>(null);
  const [noResponse, setNoResponse] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const state = useRef<RawPrint>({});
  const lastFull = useRef(0);
  const inFlight = useRef(false);
  const forceFull = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    if (document.visibilityState !== "visible") return;
    inFlight.current = true;
    setLoading(true);
    const full = forceFull.current || !isFullSnapshot(state.current) || Date.now() - lastFull.current > FULL_EVERY_MS;
    try {
      const r = await api<StatusReply>(`/api/printers/${encodeURIComponent(deviceId)}/status?full=${full ? 1 : 0}`);
      if (full) {
        lastFull.current = Date.now();
        forceFull.current = false;
        // A full snapshot replaces what we had, so stale fields don't linger.
        if (r.messages > 0) state.current = mergeReport({}, r.print);
        setNoResponse(r.messages === 0);
      } else if (r.messages > 0) {
        state.current = mergeReport(state.current, r.print);
      }
      if (r.messages > 0) {
        setLastReportAt(r.at);
        setNoResponse(false);
      }
      setRaw({ ...state.current });
      setError(null);
    } catch (e) {
      forceFull.current = true;
      setError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Live status failed.", 0));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [deviceId]);

  const schedule = useCallback(() => {
    if (stopped.current) return;
    // Only one timer chain may exist, even if refresh() races an in-flight poll.
    if (timer.current) clearTimeout(timer.current);
    const s = String(state.current.gcode_state ?? "").toUpperCase();
    const active = ["RUNNING", "PREPARE", "PAUSE", "SLICING"].includes(s);
    timer.current = setTimeout(async () => {
      await poll();
      schedule();
    }, active ? GAP_ACTIVE_MS : GAP_IDLE_MS);
  }, [poll]);

  useEffect(() => {
    stopped.current = false;
    state.current = {};
    forceFull.current = true;
    poll().then(schedule);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        if (timer.current) clearTimeout(timer.current);
        poll().then(schedule);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll, schedule]);

  const refresh = useCallback(() => {
    forceFull.current = true;
    if (timer.current) clearTimeout(timer.current);
    poll().then(schedule);
  }, [poll, schedule]);

  return { raw, lastReportAt, noResponse, error, loading, refresh };
}
