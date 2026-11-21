/** Shapes shared between API routes and client components. */

export interface PrinterSummary {
  id: string;
  name: string;
  online: boolean;
  modelCode: string;
  modelName: string;
  family: string;
  nozzleDiameter: number | null;
  /** Bambu's coarse status from /user/bind, e.g. "RUNNING", "SUCCESS", "FAILED", "IDLE". */
  printStatus: string | null;
  task: {
    name: string | null;
    status: string | null;
    progress: number | null;
    predictionS: number | null;
    startTime: string | null;
    thumbnail: string | null;
  } | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface SessionInfo {
  loggedIn: boolean;
  name?: string;
  region?: "global" | "china";
}
