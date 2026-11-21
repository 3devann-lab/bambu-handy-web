import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTERNAL_SPOOL,
  buildAmsMapping,
  buildAmsMapping2,
  buildControlCommand,
  buildLightCommand,
  buildProjectFileCommand,
  buildSpeedCommand,
  readCommandResult,
  usesAms,
  validateAmsMapping,
} from "../lib/print.ts";

test("buildAmsMapping fills gaps with -1 for skipped slots", () => {
  // Plate uses slots 1, 2, 4, 5 (API_NOTES.md §4 warns slots can skip).
  const fils = [{ slot: 1, type: "PLA" }, { slot: 2, type: "PLA" }, { slot: 4, type: "PETG" }, { slot: 5, type: "PLA" }];
  const mapping = buildAmsMapping(fils, { 1: 0, 2: 1, 4: 254, 5: 6 });
  assert.deepEqual(mapping, [0, 1, -1, 254, 6]);
});

test("buildAmsMapping2 mirrors the array as objects", () => {
  assert.deepEqual(buildAmsMapping2([0, 5, 254, -1]), [
    { ams_id: 0, slot_id: 0 },
    { ams_id: 1, slot_id: 1 },
    { ams_id: 255, slot_id: 0 },
    { ams_id: -1, slot_id: 0 },
  ]);
});

test("usesAms is true only for a real AMS tray", () => {
  assert.equal(usesAms([254, -1]), false);
  assert.equal(usesAms([0]), true);
  assert.equal(usesAms([]), false);
});

test("validateAmsMapping flags unassigned, empty and mismatched trays", () => {
  const fils = [{ slot: 1, type: "PLA" }, { slot: 2, type: "PETG" }, { slot: 3, type: "PLA" }];
  const trays = [
    { index: 0, empty: false, type: "PLA" },
    { index: 1, empty: false, type: "PLA" }, // holds PLA but slot 2 wants PETG
    { index: 2, empty: true, type: "" },
  ];
  const w = validateAmsMapping(fils, trays, { 1: 0, 2: 1, 3: 2 });
  assert.equal(w.find((x) => x.slot === 1), undefined); // 1 is fine
  assert.equal(w.find((x) => x.slot === 2)?.severity, "warn"); // type mismatch
  assert.equal(w.find((x) => x.slot === 3)?.severity, "error"); // empty tray
});

test("validateAmsMapping errors on a slot with no assignment", () => {
  const w = validateAmsMapping([{ slot: 1, type: "PLA" }], [], {});
  assert.equal(w[0].severity, "error");
});

test("validateAmsMapping lets the external spool pass", () => {
  const w = validateAmsMapping([{ slot: 1, type: "PLA" }], [], { 1: EXTERNAL_SPOOL });
  assert.deepEqual(w, []);
});

test("buildProjectFileCommand shapes the MQTT payload", () => {
  const cmd = buildProjectFileCommand({
    plateIndex: 1,
    url: "https://signed/file.gcode.3mf",
    md5: "abc",
    projectId: "p1",
    profileId: "pr1",
    taskId: "t1",
    subtaskName: "Benchy",
    mapping: [0],
  }) as { print: Record<string, unknown> };
  assert.equal(cmd.print.command, "project_file");
  assert.equal(cmd.print.param, "Metadata/plate_1.gcode");
  assert.equal(cmd.print.use_ams, true);
  assert.equal(cmd.print.url, "https://signed/file.gcode.3mf");
  assert.ok(typeof cmd.print.sequence_id === "string");
  assert.deepEqual(cmd.print.ams_mapping, [0]);
});

test("control / speed / light commands", () => {
  assert.equal((buildControlCommand("pause") as { print: { command: string } }).print.command, "pause");
  assert.equal((buildSpeedCommand(9) as { print: { param: string } }).print.param, "4"); // clamped
  assert.equal((buildSpeedCommand(0) as { print: { param: string } }).print.param, "1");
  assert.equal((buildLightCommand(true) as { system: { led_mode: string } }).system.led_mode, "on");
  assert.equal((buildLightCommand(false) as { system: { led_mode: string } }).system.led_mode, "off");
});

test("readCommandResult detects verify-failed rejections", () => {
  assert.equal(readCommandResult({ print: { command: "project_file", reason: "mqtt message verify failed" } })?.verifyFailed, true);
  assert.equal(readCommandResult({ print: { command: "project_file", err: 0x05024007 } })?.verifyFailed, true);
  assert.equal(readCommandResult({ print: { command: "pause", result: "success" } })?.ok, true);
  assert.equal(readCommandResult({ gcode_state: "RUNNING" }), null);
});
