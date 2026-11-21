import "server-only";
import { bambuFetch, type Region } from "./http";
import { modelInfo } from "./models";
import type { PrinterSummary } from "../types";

interface BindDevice {
  dev_id: string;
  name?: string;
  online?: boolean;
  print_status?: string;
  dev_model_name?: string;
  dev_product_name?: string;
  dev_access_code?: string;
  nozzle_diameter?: number;
  dev_structure?: string;
}

interface PrintDevice {
  dev_id: string;
  dev_online?: boolean;
  task_id?: string | number | null;
  task_name?: string | null;
  task_status?: string | null;
  progress?: string | number | null;
  prediction?: number | null;
  start_time?: string | null;
  thumbnail?: string | null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lists the account's printers with a coarse REST status (API_NOTES.md §3.1-3.2).
 * `dev_access_code` (the LAN password) is deliberately dropped here.
 */
export async function listPrinters(region: Region, token: string): Promise<PrinterSummary[]> {
  const [bind, print] = await Promise.all([
    bambuFetch<{ devices?: BindDevice[] }>("/v1/iot-service/api/user/bind", { region, token }),
    // The status call is best-effort. The list still renders without it.
    bambuFetch<{ devices?: PrintDevice[] }>("/v1/iot-service/api/user/print?force=true", { region, token }).catch(
      (e) => {
        if (e?.code === "AUTH_EXPIRED") throw e;
        return null;
      },
    ),
  ]);

  const statusById = new Map<string, PrintDevice>();
  for (const d of print?.data.devices ?? []) statusById.set(d.dev_id, d);

  return (bind.data.devices ?? []).map((d): PrinterSummary => {
    const s = statusById.get(d.dev_id);
    const info = modelInfo(d.dev_model_name, d.dev_product_name);
    return {
      id: d.dev_id,
      name: d.name || info.name,
      online: Boolean(d.online ?? s?.dev_online),
      modelCode: d.dev_model_name ?? "",
      modelName: info.name,
      family: info.family,
      nozzleDiameter: d.nozzle_diameter ?? null,
      printStatus: d.print_status ?? null,
      task: s && (s.task_name || s.task_status)
        ? {
            name: s.task_name ?? null,
            status: s.task_status ?? null,
            progress: num(s.progress),
            predictionS: num(s.prediction),
            startTime: s.start_time ?? null,
            thumbnail: s.thumbnail ?? null,
          }
        : null,
    };
  });
}
