import "server-only";
import { BambuError, bambuFetch, type Region } from "./http";
import { collectReports } from "./mqtt";
import { controlAccess, parseStatus, type ControlAccess, type PrinterStatus } from "../status";
import {
  buildControlCommand,
  buildLightCommand,
  buildProjectFileCommand,
  buildSpeedCommand,
  readCommandResult,
  type ControlAction,
} from "../print";

/**
 * The write half of the Bambu cloud (API_NOTES.md §5-6).
 *
 * Every command here is UNSIGNED. On firmware with authorization control the
 * printer rejects `print.*` commands ("verify failed"), so we read the
 * printer's flags first and refuse to send when control is blocked. This app
 * never obtains, extracts or emulates Bambu's signing certificate — that line
 * is deliberate (API_NOTES.md §6).
 */

export interface Preflight {
  control: ControlAccess;
  reportSeen: boolean;
  status: PrinterStatus | null;
}

/** Read one full snapshot and work out whether the firmware accepts unsigned commands. */
export async function preflight(region: Region, token: string, uid: string, deviceId: string): Promise<Preflight> {
  const r = await collectReports({ region, token, uid, deviceId, full: true, windowMs: 8_000 });
  if (r.messages === 0 || !r.print.gcode_state) {
    return { control: "unknown", reportSeen: false, status: null };
  }
  const status = parseStatus(r.print);
  return { control: controlAccess(r.print), reportSeen: true, status };
}

function assertSendable(pf: Preflight) {
  if (pf.control === "blocked") {
    throw new BambuError(
      "FIRMWARE_BLOCKED",
      "This printer's firmware only accepts print commands signed by Bambu's own apps. This app won't forge that signature.",
      409,
    );
  }
}

export interface ControlResult {
  acknowledged: boolean;
  control: ControlAccess;
}

/** Pause / resume / stop. Gated behind the firmware check. */
export async function sendControl(
  region: Region,
  token: string,
  uid: string,
  deviceId: string,
  action: ControlAction,
): Promise<ControlResult> {
  const pf = await preflight(region, token, uid, deviceId);
  assertSendable(pf);
  const cmd = buildControlCommand(action);
  return publishAndWatch(region, token, uid, deviceId, cmd, [action], pf.control);
}

export async function sendSpeed(
  region: Region,
  token: string,
  uid: string,
  deviceId: string,
  level: number,
): Promise<ControlResult> {
  const pf = await preflight(region, token, uid, deviceId);
  assertSendable(pf);
  return publishAndWatch(region, token, uid, deviceId, buildSpeedCommand(level), ["print_speed"], pf.control);
}

export async function sendLight(
  region: Region,
  token: string,
  uid: string,
  deviceId: string,
  on: boolean,
): Promise<ControlResult> {
  const pf = await preflight(region, token, uid, deviceId);
  assertSendable(pf);
  // ledctrl is a system command; still gated, because authorization control covers it too.
  return publishAndWatch(region, token, uid, deviceId, buildLightCommand(on), ["ledctrl"], pf.control);
}

/** Publish one command, then listen briefly for the printer's acknowledgement. */
async function publishAndWatch(
  region: Region,
  token: string,
  uid: string,
  deviceId: string,
  command: Record<string, unknown>,
  expectCommands: string[],
  control: ControlAccess,
): Promise<ControlResult> {
  let verifyFailed = false;
  let acknowledged = false;
  await collectReports({
    region,
    token,
    uid,
    deviceId,
    full: false,
    windowMs: 5_000,
    publish: command,
    until: (_merged, raw) => {
      const res = readCommandResult(raw);
      if (!res || !expectCommands.includes(res.command)) return false;
      verifyFailed = res.verifyFailed;
      acknowledged = res.ok;
      return true;
    },
  });
  if (verifyFailed) {
    throw new BambuError(
      "FIRMWARE_BLOCKED",
      "The printer rejected the command as unsigned. Its firmware requires Bambu-signed commands.",
      409,
    );
  }
  return { acknowledged, control };
}

interface ProfileResolve {
  url: string;
  md5: string;
  projectId: string;
  profileId: string;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/**
 * Resolve a MakerWorld profile to a downloadable sliced 3MF plus its ids
 * (API_NOTES.md §5.2). The response shape is only partly known, so this reads
 * defensively and falls back across the fields Bambu has been seen to use.
 */
export async function resolveProfile(
  region: Region,
  token: string,
  modelId: string,
  profileId: number,
  plateIndex: number,
): Promise<ProfileResolve> {
  const { data } = await bambuFetch<Record<string, unknown>>(
    `/v1/iot-service/api/user/profile/${profileId}?model_id=${encodeURIComponent(modelId)}`,
    { region, token },
  );

  // Prefer a per-plate sliced file when the response carries one.
  const context = (data.context ?? {}) as Record<string, unknown>;
  const plates = Array.isArray(context.plates) ? (context.plates as Record<string, unknown>[]) : [];
  const plate = plates.find((p) => Number(p.index ?? p.plate_index) === plateIndex) ?? plates[plateIndex - 1];
  const plateGcode = plate && typeof plate.gcode === "object" ? (plate.gcode as Record<string, unknown>) : undefined;

  const url = asStr(plateGcode?.url) || asStr(data.url) || asStr((data.gcode as Record<string, unknown> | undefined)?.url);
  const md5 = asStr(plateGcode?.md5) || asStr(data.md5) || asStr((data.gcode as Record<string, unknown> | undefined)?.md5);
  const projectId = asStr(data.project_id) || asStr(data.projectId) || asStr(data.design_id) || modelId;
  const resolvedProfileId = asStr(data.profile_id) || asStr(data.profileId) || String(profileId);

  if (!url || !md5) {
    throw new BambuError(
      "UPSTREAM_ERROR",
      "Bambu didn't return a ready-to-print file for this profile. It may need to be opened in Bambu Studio first.",
      502,
    );
  }
  return { url, md5, projectId, profileId: resolvedProfileId };
}

/** Create the cloud task (API_NOTES.md §5.1 step 8). On its own this starts nothing. */
export async function createTask(
  region: Region,
  token: string,
  args: { deviceId: string; modelId: string; profileId: number; plateIndex: number; title: string; cover: string },
): Promise<string> {
  const { data } = await bambuFetch<Record<string, unknown>>("/v1/user-service/my/task", {
    region,
    token,
    method: "POST",
    body: {
      deviceId: args.deviceId,
      modelId: args.modelId,
      profileId: args.profileId,
      plateIndex: args.plateIndex,
      title: args.title,
      cover: args.cover,
      mode: "cloud_file",
    },
    allowClientErrors: true,
  });
  const id = asStr(data.id) || asStr(data.task_id) || asStr((data.task as Record<string, unknown> | undefined)?.id);
  if (!id) {
    throw new BambuError("UPSTREAM_ERROR", "Bambu didn't return a task id when creating the print job.", 502);
  }
  return id;
}

export interface StartPrintArgs {
  deviceId: string;
  modelId: string;
  profileId: number;
  plateIndex: number;
  title: string;
  cover: string;
  mapping: number[];
}

export interface StartPrintResult {
  taskId: string;
  acknowledged: boolean;
  control: ControlAccess;
}

/**
 * Start a MakerWorld pre-sliced profile printing (the only "cloud slicing"
 * path open to third parties: the profile is already sliced in the cloud).
 * Gated behind the firmware check; refuses when control is blocked.
 */
export async function startPrint(
  region: Region,
  token: string,
  uid: string,
  args: StartPrintArgs,
): Promise<StartPrintResult> {
  const pf = await preflight(region, token, uid, args.deviceId);
  assertSendable(pf);
  if (pf.status && pf.status.state === "printing") {
    throw new BambuError("BAD_REQUEST", "This printer is already printing. Stop the current job first.", 409);
  }

  const resolved = await resolveProfile(region, token, args.modelId, args.profileId, args.plateIndex);
  const taskId = await createTask(region, token, {
    deviceId: args.deviceId,
    modelId: args.modelId,
    profileId: args.profileId,
    plateIndex: args.plateIndex,
    title: args.title,
    cover: args.cover,
  });

  const command = buildProjectFileCommand({
    plateIndex: args.plateIndex,
    url: resolved.url,
    md5: resolved.md5,
    projectId: resolved.projectId,
    profileId: resolved.profileId,
    taskId,
    subtaskName: args.title,
    mapping: args.mapping,
  });

  const res = await publishAndWatch(region, token, uid, args.deviceId, command, ["project_file"], pf.control);
  return { taskId, acknowledged: res.acknowledged, control: pf.control };
}
