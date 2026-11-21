import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  hexColor,
  isCompatible,
  isNavKey,
  parseDesignDetail,
  parseFeed,
  parseInstance,
  summaryText,
} from "../lib/makerworld.ts";

test("parseFeed narrows hits and drops rows without an id", () => {
  const feed = parseFeed({
    total: 2,
    hits: [
      {
        id: 40146,
        title: "Benchy",
        cover: "https://cdn/benchy.jpg",
        likeCount: 10,
        downloadCount: "500",
        printCount: 42,
        is_printable: true,
        is_official: true,
        nsfw: false,
        tags: ["Benchy", "", "boat"],
        designCreator: { name: "Bambu Lab", avatar: "https://cdn/a.jpg" },
      },
      { title: "no id here" },
    ],
  });
  assert.equal(feed.total, 2);
  assert.equal(feed.designs.length, 1);
  const d = feed.designs[0];
  assert.equal(d.id, 40146);
  assert.equal(d.creator, "Bambu Lab");
  assert.equal(d.downloadCount, 500);
  assert.equal(d.official, true);
  assert.deepEqual(d.tags, ["Benchy", "boat"]);
});

test("parseFeed tolerates junk", () => {
  assert.deepEqual(parseFeed(null), { total: 0, designs: [] });
  assert.deepEqual(parseFeed({ hits: "nope" }).designs, []);
});

test("hexColor normalises and rejects", () => {
  assert.equal(hexColor("#FFFFFF"), "#ffffff");
  assert.equal(hexColor("F95959FF"), "#f95959");
  assert.equal(hexColor("00000000"), null); // fully transparent
  assert.equal(hexColor("nope"), null);
  assert.equal(hexColor(null), null);
});

test("parseInstance reads plates, filaments and compatibility", () => {
  const inst = parseInstance({
    id: 109644,
    profileId: 35438952,
    title: "14min, PLA, A1",
    isDefault: true,
    appCanPrint: true,
    needAms: false,
    materialCnt: 1,
    prediction: 1895,
    weight: 12,
    instanceFilaments: [{ type: "PLA", color: "#FFFFFF", usedG: "12", usedM: "3.82" }],
    extention: {
      modelInfo: {
        compatibility: { devModelName: "N2S", devProductName: "A1", nozzleDiameter: 0.4 },
        otherCompatibility: [{ devModelName: "C12", devProductName: "P1S", nozzleDiameter: 0.4 }],
        plates: [
          {
            index: 1,
            prediction: 1895,
            weight: 12,
            thumbnail: { url: "https://cdn/plate_1.png" },
            filaments: [{ id: "1", type: "PLA", color: "#FFFFFF", usedG: "12" }],
          },
        ],
      },
    },
  });
  assert.ok(inst);
  assert.equal(inst.profileId, 35438952);
  assert.equal(inst.plates.length, 1);
  assert.equal(inst.plates[0].thumbnail, "https://cdn/plate_1.png");
  assert.equal(inst.plates[0].filaments[0].slot, 1);
  assert.equal(inst.compatibility?.modelCode, "N2S");
  assert.equal(inst.otherCompatibility[0].modelCode, "C12");
});

test("parseInstance requires an id but keeps profileId 0 (design detail drops it)", () => {
  assert.equal(parseInstance({ profileId: 5 }), null); // no id
  assert.equal(parseInstance({ id: 1, profileId: 0 })?.profileId, 0);
});

test("parseDesignDetail keeps only usable instances and dedupes cover", () => {
  const d = parseDesignDetail({
    id: 40146,
    modelId: "US123",
    title: "Benchy",
    summary: "<p>Hello</p>",
    coverUrl: "https://cdn/cover.jpg",
    designCreator: { name: "Bambu Lab", avatar: "https://cdn/a.jpg" },
    license: "BY-ND",
    isOfficial: true,
    defaultInstanceId: 109644,
    designExtension: {
      design_pictures: [{ url: "https://cdn/cover.jpg" }, { url: "https://cdn/alt.jpg" }],
    },
    instances: [
      { id: 109644, profileId: 35438952, title: "A", extention: { modelInfo: {} } },
      { id: 5, profileId: 0, title: "no profile" },
    ],
  });
  assert.ok(d);
  assert.equal(d.instances.length, 1);
  assert.deepEqual(d.pictures, ["https://cdn/alt.jpg"]); // cover removed from gallery
  assert.equal(d.defaultInstanceId, 109644);
});

test("summaryText strips tags and entities and truncates", () => {
  assert.equal(summaryText("<p>Line one</p><p>Line&nbsp;two</p>"), "Line one\nLine two");
  assert.equal(summaryText("<b>x</b>", 10), "x");
  assert.ok(summaryText("<p>" + "a".repeat(1000) + "</p>", 20).endsWith("…"));
});

test("isCompatible matches model code and nozzle", () => {
  const inst = {
    compatibility: { modelCode: "N2S", productName: "A1", nozzle: 0.4 },
    otherCompatibility: [{ modelCode: "C12", productName: "P1S", nozzle: 0.4 }],
  };
  assert.equal(isCompatible("N2S", 0.4, inst), true);
  assert.equal(isCompatible("C12", 0.4, inst), true); // via otherCompatibility
  assert.equal(isCompatible("C12", 0.6, inst), false); // nozzle mismatch
  assert.equal(isCompatible("O1D", 0.4, inst), false); // model not listed
  assert.equal(isCompatible("N2S", null, inst), true); // unknown nozzle: allow on model match
  assert.equal(isCompatible("", 0.4, inst), false);
});

test("category list and nav-key guard", () => {
  assert.ok(CATEGORIES.some((c) => c.key === "Trending"));
  assert.equal(isNavKey("Trending"), true);
  assert.equal(isNavKey("../etc"), false);
});
