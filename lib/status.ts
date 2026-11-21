/**
 * Pure helpers for Bambu MQTT `print` reports (API_NOTES.md §3.3).
 * No imports with runtime effects, so the browser, the server and the
 * unit tests (node --test) can all use this file.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type RawPrint = { [k: string]: Json };

/**
 * Merge a delta report into the last known state. P1/A1 printers only send
 * changed fields. Objects merge recursively. Arrays and scalars replace,
 * because the firmware always resends a whole array (hms, ams.ams, …) when
 * anything in it changes.
 */
export function mergeReport(base: RawPrint, delta: RawPrint): RawPrint {
  const out: RawPrint = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    const prev = out[k];
    if (isObj(v) && isObj(prev)) out[k] = mergeReport(prev, v);
    else out[k] = v;
  }
  return out;
}

function isObj(v: unknown): v is RawPrint {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: Json | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: Json | undefined): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type JobState = "idle" | "preparing" | "printing" | "paused" | "finished" | "failed" | "offline" | "unknown";

export interface Tray {
  /** Global tray index used by AMS mapping: amsId * 4 + slot, or 254 for the external spool. */
  index: number;
  amsId: number;
  slot: number;
  empty: boolean;
  type: string;
  /** Lower-case `#rrggbb`, or null when unknown. */
  color: string | null;
  colors: string[];
  name: string;
  filamentId: string;
  /** Remaining %, or null if the printer doesn't know (non-RFID spool). */
  remain: number | null;
  active: boolean;
}

export interface AmsUnit {
  id: number;
  humidity: number | null;
  tempC: number | null;
  trays: Tray[];
}

export interface HmsAlert {
  code: string;
  severity: "fatal" | "serious" | "common" | "info" | "unknown";
}

export type ControlAccess = "allowed" | "blocked" | "unknown";

export interface PrinterStatus {
  state: JobState;
  rawState: string;
  jobName: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  nozzle: { temp: number | null; target: number | null };
  bed: { temp: number | null; target: number | null };
  chamber: number | null;
  ams: AmsUnit[];
  externalSpool: Tray | null;
  activeTray: number | null;
  /** Non-zero print error code formatted like `0300_4000`, or null. */
  printError: string | null;
  hms: HmsAlert[];
  /** Whether the firmware accepts unsigned print commands from third-party apps (API_NOTES.md §6). */
  control: ControlAccess;
  hasCamera: boolean;
  /** Chamber/frame light: true on, false off, null when the printer doesn't report it. */
  chamberLight: boolean | null;
  speedLevel: number | null;
  wifiSignal: string;
  stage: number | null;
  taskId: string;
}

const STATE_MAP: Record<string, JobState> = {
  IDLE: "idle",
  PREPARE: "preparing",
  SLICING: "preparing",
  INIT: "preparing",
  RUNNING: "printing",
  PAUSE: "paused",
  FINISH: "finished",
  FAILED: "failed",
  OFFLINE: "offline",
};

/** `#rrggbb` from Bambu's `RRGGBBAA`, or null for unset/transparent. */
export function trayColor(raw: Json | undefined): string | null {
  const s = text(raw).replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  if (s.length === 8 && s.slice(6).toLowerCase() === "00") return null;
  return `#${s.slice(0, 6).toLowerCase()}`;
}

function parseTray(raw: RawPrint, amsId: number, activeTray: number | null): Tray {
  const slot = num(raw.id) ?? 0;
  const index = amsId === 255 ? 254 : amsId * 4 + slot;
  const type = text(raw.tray_type);
  const remain = num(raw.remain);
  const colors = Array.isArray(raw.cols) ? raw.cols.map((c) => trayColor(c)).filter((c): c is string => !!c) : [];
  return {
    index,
    amsId,
    slot,
    empty: !type,
    type,
    color: trayColor(raw.tray_color) ?? colors[0] ?? null,
    colors,
    name: text(raw.tray_sub_brands) || type,
    filamentId: text(raw.tray_info_idx),
    remain: remain != null && remain >= 0 ? remain : null,
    active: activeTray === index,
  };
}

export function hmsCode(attr: number, code: number): string {
  const h = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const a = h(attr);
  const c = h(code);
  return `${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`;
}

const SEVERITY: Record<number, HmsAlert["severity"]> = { 1: "fatal", 2: "serious", 3: "common", 4: "info" };

/** Signing requirement bits, per ha-bambulab (API_NOTES.md §6). */
export const FUN_SIGNATURE_REQUIRED = 0x20000000;
export const FLAG3_AUTH_CONTROL = 0x10;

export function controlAccess(p: RawPrint): ControlAccess {
  const fun = text(p.fun);
  if (fun && /^[0-9a-fA-F]+$/.test(fun)) {
    // The flag sits in the low 32 bits. Parse the tail to avoid precision loss on long hex strings.
    const low = parseInt(fun.slice(-8), 16);
    return (low & FUN_SIGNATURE_REQUIRED) !== 0 ? "blocked" : "allowed";
  }
  const flag3 = num(p.flag3);
  if (flag3 != null) return (flag3 & FLAG3_AUTH_CONTROL) !== 0 ? "blocked" : "allowed";
  return "unknown";
}

export function parseStatus(p: RawPrint): PrinterStatus {
  const rawState = text(p.gcode_state).toUpperCase();
  const amsRoot = isObj(p.ams) ? p.ams : {};
  const trayNow = num(amsRoot.tray_now);
  const activeTray = trayNow != null && trayNow !== 255 ? trayNow : null;

  const units: AmsUnit[] = Array.isArray(amsRoot.ams)
    ? amsRoot.ams.filter(isObj).map((u) => {
        const id = num(u.id) ?? 0;
        return {
          id,
          humidity: num(u.humidity),
          tempC: num(u.temp),
          trays: Array.isArray(u.tray) ? u.tray.filter(isObj).map((t) => parseTray(t, id, activeTray)) : [],
        };
      })
    : [];

  const vt = isObj(p.vt_tray) ? parseTray(p.vt_tray, 255, activeTray) : null;

  const errNum = num(p.print_error) ?? 0;
  const printError = errNum
    ? (() => {
        const h = (errNum >>> 0).toString(16).toUpperCase().padStart(8, "0");
        return `${h.slice(0, 4)}_${h.slice(4)}`;
      })()
    : null;

  const hms: HmsAlert[] = Array.isArray(p.hms)
    ? p.hms.filter(isObj).map((h) => {
        const attr = num(h.attr) ?? 0;
        const code = num(h.code) ?? 0;
        return { code: hmsCode(attr, code), severity: SEVERITY[(code >>> 16) & 0xffff] ?? "unknown" };
      })
    : [];

  const ipcam = isObj(p.ipcam) ? p.ipcam : null;

  let chamberLight: boolean | null = null;
  if (Array.isArray(p.lights_report)) {
    const node = p.lights_report.filter(isObj).find((l) => text(l.node) === "chamber_light" || text(l.node) === "work_light");
    if (node) chamberLight = text(node.mode).toLowerCase() === "on";
  }

  return {
    state: STATE_MAP[rawState] ?? (rawState ? "unknown" : "unknown"),
    rawState,
    jobName: text(p.subtask_name) || text(p.gcode_file),
    percent: num(p.mc_percent),
    remainingMin: num(p.mc_remaining_time),
    layer: num(p.layer_num),
    totalLayers: num(p.total_layer_num),
    nozzle: { temp: num(p.nozzle_temper), target: num(p.nozzle_target_temper) },
    bed: { temp: num(p.bed_temper), target: num(p.bed_target_temper) },
    chamber: num(p.chamber_temper),
    ams: units,
    externalSpool: vt,
    activeTray,
    printError,
    hms,
    control: controlAccess(p),
    hasCamera: ipcam ? text(ipcam.ipcam_dev) === "1" : false,
    chamberLight,
    speedLevel: num(p.spd_lvl),
    wifiSignal: text(p.wifi_signal),
    stage: num(p.mc_print_stage),
    taskId: text(p.task_id),
  };
}

/** True once we've seen enough of a report to render a full status card. */
export function isFullSnapshot(p: RawPrint): boolean {
  return "gcode_state" in p && ("nozzle_temper" in p || "bed_temper" in p);
}

export const SPEED_LABELS: Record<number, string> = { 1: "Silent", 2: "Standard", 3: "Sport", 4: "Ludicrous" };
