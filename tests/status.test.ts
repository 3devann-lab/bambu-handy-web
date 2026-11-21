import { test } from "node:test";
import assert from "node:assert/strict";
import { controlAccess, hmsCode, isFullSnapshot, mergeReport, parseStatus, trayColor } from "../lib/status.ts";

const fullP1 = {
  gcode_state: "RUNNING",
  mc_percent: 42,
  mc_remaining_time: 75,
  layer_num: 120,
  total_layer_num: 300,
  nozzle_temper: 219.6,
  nozzle_target_temper: 220,
  bed_temper: 55,
  bed_target_temper: 55,
  chamber_temper: 0,
  subtask_name: "Planter_v3",
  print_error: 0,
  hms: [],
  spd_lvl: 2,
  fun: "3EC1AFFF9CFF",
  ipcam: { ipcam_dev: "1" },
  ams: {
    tray_now: "1",
    ams: [
      {
        id: "0",
        humidity: "4",
        temp: "22.7",
        tray: [
          { id: "0" },
          { id: "1", tray_type: "PLA", tray_color: "000000FF", tray_sub_brands: "PLA Basic", remain: 80, tray_info_idx: "GFA00" },
          { id: "2", tray_type: "PETG", tray_color: "DFE2E3FF", remain: -1, cols: ["DFE2E3FF"] },
          { id: "3", tray_type: "PLA", tray_color: "F95959FF", cols: ["F95959FF", "00AE42FF"] },
        ],
      },
    ],
  },
  vt_tray: { id: "254", tray_type: "", tray_color: "00000000" },
};

test("mergeReport merges nested objects and replaces arrays", () => {
  const delta = { mc_percent: 43, ams: { tray_now: "2" }, hms: [{ attr: 1, code: 2 }] };
  const merged = mergeReport(fullP1 as never, delta as never);
  assert.equal(merged.mc_percent, 43);
  assert.equal(merged.gcode_state, "RUNNING");
  assert.equal((merged.ams as Record<string, unknown>).tray_now, "2");
  // untouched nested arrays survive the delta
  assert.equal(((merged.ams as Record<string, unknown>).ams as unknown[]).length, 1);
  assert.deepEqual(merged.hms, [{ attr: 1, code: 2 }]);
  // input not mutated
  assert.equal(fullP1.mc_percent, 42);
});

test("parseStatus extracts job, temps and AMS trays", () => {
  const s = parseStatus(fullP1 as never);
  assert.equal(s.state, "printing");
  assert.equal(s.percent, 42);
  assert.equal(s.remainingMin, 75);
  assert.equal(s.layer, 120);
  assert.equal(s.totalLayers, 300);
  assert.equal(s.nozzle.target, 220);
  assert.equal(s.jobName, "Planter_v3");
  assert.equal(s.hasCamera, true);
  assert.equal(s.ams.length, 1);
  const [t0, t1, t2, t3] = s.ams[0].trays;
  assert.equal(t0.empty, true);
  assert.equal(t1.color, "#000000");
  assert.equal(t1.name, "PLA Basic");
  assert.equal(t1.remain, 80);
  assert.equal(t1.active, true);
  assert.equal(t1.index, 1);
  assert.equal(t2.remain, null, "remain -1 means unknown");
  assert.deepEqual(t3.colors, ["#f95959", "#00ae42"]);
  assert.equal(s.externalSpool?.index, 254);
  assert.equal(s.externalSpool?.empty, true);
  assert.equal(s.printError, null);
});

test("global tray index accounts for the AMS unit", () => {
  const s = parseStatus({ gcode_state: "IDLE", ams: { tray_now: "255", ams: [{ id: "1", tray: [{ id: "2", tray_type: "PLA" }] }] } } as never);
  assert.equal(s.ams[0].trays[0].index, 6);
  assert.equal(s.activeTray, null);
});

test("trayColor handles alpha and junk", () => {
  assert.equal(trayColor("FF0000FF"), "#ff0000");
  assert.equal(trayColor("00000000"), null);
  assert.equal(trayColor("nope"), null);
  assert.equal(trayColor("#00AE42"), "#00ae42");
});

test("controlAccess reads fun bit 29 and flag3 fallback", () => {
  // Examples from ha-bambulab: dev mode disabled vs enabled.
  assert.equal(controlAccess({ fun: "3EC1AFFF9CFF" }), "blocked");
  assert.equal(controlAccess({ fun: "3EC18FFF9CFF" }), "allowed");
  assert.equal(controlAccess({ fun: "", flag3: 0x10010 }), "blocked");
  assert.equal(controlAccess({ flag3: 0x10000 }), "allowed");
  assert.equal(controlAccess({}), "unknown");
});

test("hms and print error codes are formatted like the Bambu wiki", () => {
  assert.equal(hmsCode(50331904, 65543), "0300_0100_0001_0007");
  const s = parseStatus({ gcode_state: "FAILED", print_error: 0x0300400c, hms: [{ attr: 50331904, code: 65543 }] } as never);
  assert.equal(s.printError, "0300_400C");
  assert.equal(s.hms[0].code, "0300_0100_0001_0007");
  assert.equal(s.hms[0].severity, "fatal");
  assert.equal(s.state, "failed");
});

test("isFullSnapshot", () => {
  assert.equal(isFullSnapshot({ mc_percent: 3 } as never), false);
  assert.equal(isFullSnapshot(fullP1 as never), true);
});

test("parseStatus reads chamber light from lights_report", () => {
  assert.equal(parseStatus({ gcode_state: "IDLE", lights_report: [{ node: "chamber_light", mode: "on" }] } as never).chamberLight, true);
  assert.equal(parseStatus({ gcode_state: "IDLE", lights_report: [{ node: "chamber_light", mode: "off" }] } as never).chamberLight, false);
  assert.equal(parseStatus({ gcode_state: "IDLE" } as never).chamberLight, null);
});
