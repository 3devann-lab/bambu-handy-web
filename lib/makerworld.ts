/**
 * Pure helpers for MakerWorld's design/search API (API_NOTES.md §4).
 *
 * No runtime-effect imports, so the browser, the server routes and the
 * node:test suite can all share this file (same rule as lib/status.ts).
 * Everything here is parsing and shape-narrowing of untrusted JSON.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

function isObj(v: Json | undefined): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: Json | undefined): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function int(v: Json | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function flo(v: Json | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `#rrggbb` (lower-case) from MakerWorld's `#RRGGBB`/`RRGGBBAA`, or null. */
export function hexColor(raw: Json | undefined): string | null {
  const s = str(raw).replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  if (s.length === 8 && s.slice(6).toLowerCase() === "00") return null;
  return `#${s.slice(0, 6).toLowerCase()}`;
}

/** A card in the browse/search grid. */
export interface DesignCard {
  id: number;
  title: string;
  cover: string;
  creator: string;
  creatorAvatar: string | null;
  likeCount: number;
  downloadCount: number;
  printCount: number;
  printable: boolean;
  official: boolean;
  nsfw: boolean;
  tags: string[];
}

export interface Feed {
  total: number;
  designs: DesignCard[];
}

export function parseFeedHit(raw: Json): DesignCard | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  if (id == null) return null;
  const creator = isObj(raw.designCreator) ? raw.designCreator : {};
  const cover = str(raw.cover) || str(raw.coverUrl) || str(raw.coverPortrait);
  return {
    id,
    title: str(raw.title) || `Design ${id}`,
    cover,
    creator: str(creator.name) || "Unknown creator",
    creatorAvatar: str(creator.avatar) || null,
    likeCount: int(raw.likeCount) ?? 0,
    downloadCount: int(raw.downloadCount) ?? 0,
    printCount: int(raw.printCount) ?? 0,
    printable: raw.is_printable !== false,
    official: raw.is_official === true,
    nsfw: raw.nsfw === true,
    tags: Array.isArray(raw.tags) ? raw.tags.map(str).filter(Boolean).slice(0, 12) : [],
  };
}

export function parseFeed(raw: Json): Feed {
  const o = isObj(raw) ? raw : {};
  const hits = Array.isArray(o.hits) ? o.hits : [];
  return {
    total: int(o.total) ?? hits.length,
    designs: hits.map(parseFeedHit).filter((d): d is DesignCard => d !== null),
  };
}

/** One printer this profile was sliced for (or is advertised as fitting). */
export interface Compat {
  modelCode: string;
  productName: string;
  nozzle: number | null;
}

export interface PlateFilament {
  /** 1-based project slot. Can skip numbers (API_NOTES.md §4). */
  slot: number;
  type: string;
  color: string | null;
  usedG: number | null;
  usedM: number | null;
}

export interface Plate {
  index: number;
  name: string;
  thumbnail: string | null;
  /** Seconds. */
  prediction: number | null;
  /** Grams. */
  weight: number | null;
  filaments: PlateFilament[];
}

/** A creator-made, pre-sliced print profile (API_NOTES.md §4 "instances"). */
export interface Instance {
  id: number;
  profileId: number;
  title: string;
  cover: string | null;
  isDefault: boolean;
  appCanPrint: boolean;
  needAms: boolean;
  materialCount: number | null;
  /** Seconds. */
  prediction: number | null;
  /** Grams. */
  weight: number | null;
  filaments: PlateFilament[];
  compatibility: Compat | null;
  otherCompatibility: Compat[];
  plates: Plate[];
}

export interface DesignDetail {
  id: number;
  modelId: string;
  title: string;
  /** Raw HTML summary from MakerWorld. Render as text only — never dangerouslySetInnerHTML. */
  summaryHtml: string;
  cover: string;
  pictures: string[];
  creator: string;
  creatorAvatar: string | null;
  likeCount: number;
  downloadCount: number;
  printCount: number;
  license: string;
  official: boolean;
  nsfw: boolean;
  defaultInstanceId: number | null;
  instances: Instance[];
}

function parseCompat(raw: Json | undefined): Compat | null {
  if (!isObj(raw)) return null;
  const modelCode = str(raw.devModelName);
  if (!modelCode) return null;
  return { modelCode, productName: str(raw.devProductName), nozzle: flo(raw.nozzleDiameter) };
}

function parseFilament(raw: Json, fallbackSlot: number): PlateFilament {
  const o = isObj(raw) ? raw : {};
  return {
    slot: int(o.id) ?? fallbackSlot,
    type: str(o.type) || "Unknown",
    color: hexColor(o.color),
    usedG: flo(o.usedG),
    usedM: flo(o.usedM),
  };
}

function parsePlate(raw: Json, fallbackIndex: number): Plate {
  const o = isObj(raw) ? raw : {};
  const thumb = isObj(o.thumbnail) ? str(o.thumbnail.url) : "";
  const fils = Array.isArray(o.filaments) ? o.filaments : [];
  return {
    index: int(o.index) ?? fallbackIndex,
    name: str(o.name),
    thumbnail: thumb || null,
    prediction: int(o.prediction),
    weight: flo(o.weight),
    filaments: fils.map((f, i) => parseFilament(f, i + 1)),
  };
}

export function parseInstance(raw: Json): Instance | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  if (id == null) return null;
  const modelInfo = isObj(raw.extention) && isObj(raw.extention.modelInfo) ? raw.extention.modelInfo : {};
  const plates = Array.isArray(modelInfo.plates) ? modelInfo.plates : [];
  const fils = Array.isArray(raw.instanceFilaments) ? raw.instanceFilaments : [];
  const other = Array.isArray(modelInfo.otherCompatibility) ? modelInfo.otherCompatibility : [];
  return {
    id,
    profileId: int(raw.profileId) ?? 0,
    title: str(raw.title) || "Print profile",
    cover: str(raw.cover) || null,
    isDefault: raw.isDefault === true,
    appCanPrint: raw.appCanPrint !== false,
    needAms: raw.needAms === true,
    materialCount: int(raw.materialCnt),
    prediction: int(raw.prediction),
    weight: flo(raw.weight),
    filaments: fils.map((f, i) => parseFilament(f, i + 1)),
    compatibility: parseCompat(modelInfo.compatibility),
    otherCompatibility: other.map(parseCompat).filter((c): c is Compat => c !== null),
    plates: plates.map(parsePlate),
  };
}

export function parseDesignDetail(raw: Json): DesignDetail | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  if (id == null) return null;
  const creator = isObj(raw.designCreator) ? raw.designCreator : {};
  const ext = isObj(raw.designExtension) ? raw.designExtension : {};
  const pics = Array.isArray(ext.design_pictures) ? ext.design_pictures : [];
  const instancesRaw = Array.isArray(raw.instances) ? raw.instances : [];
  const cover = str(raw.coverUrl) || str(raw.cover);
  return {
    id,
    modelId: str(raw.modelId),
    title: str(raw.title) || `Design ${id}`,
    summaryHtml: str(raw.summary),
    cover,
    pictures: pics
      .map((p) => (isObj(p) ? str(p.url) : ""))
      .filter((u) => u && u !== cover)
      .slice(0, 8),
    creator: str(creator.name) || "Unknown creator",
    creatorAvatar: str(creator.avatar) || null,
    likeCount: int(raw.likeCount) ?? 0,
    downloadCount: int(raw.downloadCount) ?? 0,
    printCount: int(raw.printCount) ?? 0,
    license: str(raw.license),
    official: raw.isOfficial === true,
    nsfw: raw.nsfw === true,
    defaultInstanceId: int(raw.defaultInstanceId),
    instances: instancesRaw.map(parseInstance).filter((i): i is Instance => i !== null && i.profileId > 0),
  };
}

/** Strip MakerWorld's HTML summary down to plain text for safe display. */
export function summaryText(html: string, max = 600): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/**
 * Whether a printer can print this profile: its model code must match the
 * profile's own compatibility or one of the advertised others, and the nozzle
 * diameter must match when both are known (API_NOTES.md §4 "Compatibility rule").
 */
export function isCompatible(
  printerModelCode: string,
  printerNozzle: number | null,
  instance: Pick<Instance, "compatibility" | "otherCompatibility">,
): boolean {
  if (!printerModelCode) return false;
  const all = [instance.compatibility, ...instance.otherCompatibility].filter(
    (c): c is Compat => c !== null,
  );
  const code = printerModelCode.toLowerCase();
  return all.some((c) => {
    if (c.modelCode.toLowerCase() !== code) return false;
    if (c.nozzle != null && printerNozzle != null) {
      return Math.abs(c.nozzle - printerNozzle) < 0.01;
    }
    return true;
  });
}

const NAV_KEYS = ["Trending", "Popular", "Latest", "category_400", "category_800"] as const;
export type NavKey = (typeof NAV_KEYS)[number];

export interface Category {
  key: NavKey;
  label: string;
}

export const CATEGORIES: Category[] = [
  { key: "Trending", label: "Trending" },
  { key: "Popular", label: "Popular" },
  { key: "Latest", label: "Latest" },
  { key: "category_400", label: "Toys & Games" },
  { key: "category_800", label: "Home & Living" },
];

export function isNavKey(v: string): v is NavKey {
  return (NAV_KEYS as readonly string[]).includes(v);
}
