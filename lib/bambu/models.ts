/** Printer model codes (`dev_model_name`) → friendly names and capability hints. Shared by client and server. */

export interface ModelInfo {
  name: string;
  family: "X1" | "P1" | "P2" | "A1" | "A2" | "H2" | "H3" | "X2" | "unknown";
  /** Firmware on this model ships with authorization control from day one. */
  alwaysAuthorized?: boolean;
  /** Sends delta-only MQTT reports (needs periodic pushall). */
  deltaReports?: boolean;
}

const MODELS: Record<string, ModelInfo> = {
  "BL-P001": { name: "X1 Carbon", family: "X1" },
  "BL-P002": { name: "X1", family: "X1" },
  C13: { name: "X1E", family: "X1" },
  C11: { name: "P1P", family: "P1", deltaReports: true },
  C12: { name: "P1S", family: "P1", deltaReports: true },
  N7: { name: "P2S", family: "P2", alwaysAuthorized: true, deltaReports: true },
  N1: { name: "A1 mini", family: "A1", deltaReports: true },
  N2S: { name: "A1", family: "A1", deltaReports: true },
  N9: { name: "A2L", family: "A2", alwaysAuthorized: true, deltaReports: true },
  O1D: { name: "H2D", family: "H2", alwaysAuthorized: true },
  O1E: { name: "H2D Pro", family: "H2", alwaysAuthorized: true },
  O1S: { name: "H2S", family: "H2", alwaysAuthorized: true },
  O1C2: { name: "H2C", family: "H2", alwaysAuthorized: true },
  N10: { name: "H3C", family: "H3", alwaysAuthorized: true },
  N6: { name: "X2D", family: "X2", alwaysAuthorized: true },
};

export function modelInfo(code: string | undefined, productName?: string): ModelInfo {
  if (code && MODELS[code]) return MODELS[code];
  // Newer models sometimes report the marketing name as the model code.
  const byName = Object.values(MODELS).find(
    (m) => m.name.toLowerCase() === (productName ?? code ?? "").toLowerCase(),
  );
  if (byName) return byName;
  return { name: productName || code || "Unknown printer", family: "unknown", alwaysAuthorized: true };
}
