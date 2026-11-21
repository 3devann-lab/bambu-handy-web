/**
 * Pure helpers for building the MQTT commands this app sends to a printer
 * (API_NOTES.md §5-6). No runtime-effect imports: shared by the server print
 * route and the node:test suite.
 *
 * None of these commands are *signed*. On firmware with authorization control
 * the printer rejects every `print.*` command here with "verify failed"
 * (API_NOTES.md §6). The server checks that first; these builders just produce
 * the payloads. This app never forges Bambu's signing certificate.
 */

export const EXTERNAL_SPOOL = 254;
export const TRAY_UNUSED = -1;

/** One tray reported by the printer, as far as mapping validation cares. */
export interface MapTray {
  index: number;
  empty: boolean;
  type: string;
}

/** A filament slot a plate needs. `slot` is 1-based and may skip numbers. */
export interface MapFilament {
  slot: number;
  type: string;
}

/**
 * Build Bambu Studio's `ams_mapping`: an array indexed by (slot - 1). Each
 * value is a global tray index (`ams_id * 4 + slot`), 254 for the external
 * spool, or -1 for a slot left unused. Slots can skip numbers, so gaps become
 * -1 (API_NOTES.md §5.3).
 */
export function buildAmsMapping(filaments: MapFilament[], assignment: Record<number, number>): number[] {
  const maxSlot = filaments.reduce((m, f) => Math.max(m, f.slot), 0);
  const arr = new Array<number>(maxSlot).fill(TRAY_UNUSED);
  for (const f of filaments) {
    const v = assignment[f.slot];
    arr[f.slot - 1] = Number.isInteger(v) ? v : TRAY_UNUSED;
  }
  return arr;
}

/** The newer object form of the mapping (`ams_mapping2`), kept in step with `ams_mapping`. */
export function buildAmsMapping2(mapping: number[]): { ams_id: number; slot_id: number }[] {
  return mapping.map((v) => {
    if (v === EXTERNAL_SPOOL) return { ams_id: 255, slot_id: 0 };
    if (v < 0) return { ams_id: -1, slot_id: 0 };
    return { ams_id: Math.floor(v / 4), slot_id: v % 4 };
  });
}

/** True when any slot is mapped to an AMS tray (not just the external spool / unused). */
export function usesAms(mapping: number[]): boolean {
  return mapping.some((v) => v >= 0 && v !== EXTERNAL_SPOOL);
}

export interface MapWarning {
  slot: number;
  severity: "error" | "warn";
  message: string;
}

/**
 * Flag mapping problems before sending. A wrong mapping makes the printer
 * pause and wait instead of printing (API_NOTES.md §5.3), so a type mismatch
 * or an empty mapped tray is worth confirming first.
 */
export function validateAmsMapping(
  filaments: MapFilament[],
  trays: MapTray[],
  assignment: Record<number, number>,
): MapWarning[] {
  const byIndex = new Map(trays.map((t) => [t.index, t]));
  const out: MapWarning[] = [];
  for (const f of filaments) {
    const v = assignment[f.slot];
    if (!Number.isInteger(v) || v === TRAY_UNUSED) {
      out.push({ slot: f.slot, severity: "error", message: `Slot ${f.slot} (${f.type}) has no filament assigned.` });
      continue;
    }
    if (v === EXTERNAL_SPOOL) continue; // External spool: whatever's loaded is the user's call.
    const tray = byIndex.get(v);
    if (!tray || tray.empty) {
      out.push({ slot: f.slot, severity: "error", message: `Slot ${f.slot} (${f.type}) is mapped to an empty tray.` });
      continue;
    }
    if (tray.type && f.type && tray.type.toUpperCase() !== f.type.toUpperCase()) {
      out.push({
        slot: f.slot,
        severity: "warn",
        message: `Slot ${f.slot} wants ${f.type} but the mapped tray holds ${tray.type}.`,
      });
    }
  }
  return out;
}

export function sequenceId(): string {
  return String(Date.now() % 1_000_000);
}

export interface ProjectFileParams {
  plateIndex: number;
  url: string;
  md5: string;
  projectId: string;
  profileId: string;
  taskId: string;
  subtaskName: string;
  mapping: number[];
  /** Bed / calibration toggles, all defaulting to Studio's defaults. */
  options?: Partial<{
    bedLevelling: boolean;
    flowCali: boolean;
    vibrationCali: boolean;
    layerInspect: boolean;
    timelapse: boolean;
  }>;
}

/**
 * The `project_file` command that actually starts a print (API_NOTES.md §5.1).
 * Creating the cloud task alone starts nothing; this MQTT command does.
 */
export function buildProjectFileCommand(p: ProjectFileParams): Record<string, unknown> {
  const o = p.options ?? {};
  return {
    print: {
      sequence_id: sequenceId(),
      command: "project_file",
      param: `Metadata/plate_${p.plateIndex}.gcode`,
      url: p.url,
      md5: p.md5,
      project_id: p.projectId,
      profile_id: p.profileId,
      task_id: p.taskId,
      subtask_id: "0",
      subtask_name: p.subtaskName,
      bed_type: "auto",
      bed_levelling: o.bedLevelling ?? true,
      flow_cali: o.flowCali ?? true,
      vibration_cali: o.vibrationCali ?? true,
      layer_inspect: o.layerInspect ?? true,
      timelapse: o.timelapse ?? false,
      use_ams: usesAms(p.mapping),
      ams_mapping: p.mapping,
      ams_mapping2: buildAmsMapping2(p.mapping),
    },
  };
}

export type ControlAction = "pause" | "resume" | "stop";

export function buildControlCommand(action: ControlAction): Record<string, unknown> {
  return { print: { sequence_id: sequenceId(), command: action } };
}

/** Print speed level: 1 Silent, 2 Standard, 3 Sport, 4 Ludicrous. */
export function buildSpeedCommand(level: number): Record<string, unknown> {
  const clamped = Math.min(4, Math.max(1, Math.trunc(level)));
  return { print: { sequence_id: sequenceId(), command: "print_speed", param: String(clamped) } };
}

/** Chamber / frame light. */
export function buildLightCommand(on: boolean): Record<string, unknown> {
  return {
    system: {
      sequence_id: sequenceId(),
      command: "ledctrl",
      led_node: "chamber_light",
      led_mode: on ? "on" : "off",
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 0,
      interval_time: 0,
    },
  };
}

/** A printer report reply often carries `print.command` + a result code. */
export function readCommandResult(
  raw: Record<string, unknown>,
): { command: string; ok: boolean; verifyFailed: boolean } | null {
  const print = raw.print;
  if (!print || typeof print !== "object") return null;
  const p = print as Record<string, unknown>;
  const command = typeof p.command === "string" ? p.command : "";
  if (!command) return null;
  const result = typeof p.result === "string" ? p.result.toLowerCase() : "";
  const reason = typeof p.reason === "string" ? p.reason.toLowerCase() : "";
  const errno = typeof p.err === "number" ? p.err : Number(p.err ?? 0);
  // "verify failed" / 0x0502400x mean the firmware rejected an unsigned command.
  const verifyFailed =
    /verify\s*fail/.test(reason) ||
    /verify\s*fail/.test(result) ||
    (Number.isFinite(errno) && (errno >>> 0).toString(16).toUpperCase().startsWith("502400"));
  const ok = result === "success" || (!verifyFailed && result !== "fail" && errno === 0);
  return { command, ok, verifyFailed };
}
