import "server-only";
import { randomUUID } from "node:crypto";
import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import { BambuError, MQTT_HOST, bambuFetch, type Region } from "./http";
import { isFullSnapshot, mergeReport, type RawPrint } from "../status";

/**
 * Short-lived cloud MQTT sessions (API_NOTES.md §3.3).
 *
 * Vercel functions can't keep a connection open between requests, so each
 * status poll connects, subscribes to the printer's report topic, optionally
 * asks for a full snapshot, collects messages for a few seconds, and
 * disconnects. The browser keeps the merged state between polls.
 *
 * Never logs: the MQTT password *is* the access token.
 */

export interface CollectOptions {
  region: Region;
  token: string;
  uid: string;
  deviceId: string;
  /** Send `pushall` and wait for a full snapshot (expensive for P1P; see notes). */
  full: boolean;
  /** Max time to listen after subscribing. */
  windowMs: number;
  /** Optional raw command to publish after subscribing (used by the print flow later). */
  publish?: Record<string, unknown>;
  /** Stop early as soon as this returns true for the merged state / raw message. */
  until?: (merged: RawPrint, raw: Record<string, unknown>) => boolean;
}

export interface CollectResult {
  print: RawPrint;
  messages: number;
  full: boolean;
  /** Raw non-`print` replies (e.g. `info`, `system`), last one per key. */
  other: Record<string, unknown>;
}

function brokerUrl(region: Region): string {
  // A local broker override exists for development and tests only. It's ignored in production builds.
  const override = process.env.NODE_ENV !== "production" ? process.env.BHW_DEV_MQTT_URL : undefined;
  return override || `mqtts://${MQTT_HOST[region]}:8883`;
}

async function connect(opts: CollectOptions): Promise<MqttClient> {
  const options: IClientOptions = {
    username: `u_${opts.uid}`,
    password: opts.token,
    clientId: `bhw_${randomUUID().slice(0, 18)}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 6_000,
    keepalive: 30,
    protocolVersion: 4,
    rejectUnauthorized: true,
  };

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl(opts.region), options);
    let settled = false;
    const fail = (err: BambuError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    };
    client.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(client);
    });
    client.once("error", (err: Error & { code?: number | string }) => {
      // CONNACK 4 = bad username/password, 5 = not authorized.
      if (err.code === 4 || err.code === 5 || /not authori[sz]ed|bad user/i.test(err.message)) {
        fail(new BambuError("AUTH_EXPIRED", "MQTT_NOT_AUTHORIZED", 401));
      } else {
        fail(new BambuError("NETWORK", "Couldn't connect to Bambu's live-status service.", 504));
      }
    });
    const timeout = setTimeout(
      () => fail(new BambuError("NETWORK", "Timed out connecting to Bambu's live-status service.", 504)),
      7_000,
    );
  });
}

export async function collectReports(opts: CollectOptions): Promise<CollectResult> {
  let client: MqttClient;
  try {
    client = await connect(opts);
  } catch (e) {
    if (e instanceof BambuError && e.message === "MQTT_NOT_AUTHORIZED") {
      // The broker refused us. Ask the REST API whether the token itself is dead
      // (bambuFetch throws AUTH_EXPIRED on 401) or the broker is just picky.
      await bambuFetch("/v1/design-user-service/my/preference", { region: opts.region, token: opts.token });
      throw new BambuError("UPSTREAM_ERROR", "Bambu's live-status service refused the connection.", 502);
    }
    throw e;
  }

  const reportTopic = `device/${opts.deviceId}/report`;
  const requestTopic = `device/${opts.deviceId}/request`;
  let merged: RawPrint = {};
  let messages = 0;
  const other: Record<string, unknown> = {};

  try {
    await new Promise<void>((resolve, reject) => {
      client.subscribe(reportTopic, { qos: 0 }, (err, granted) => {
        // Bambu's broker answers with QoS 128 when the device isn't bound to this account.
        if (err || granted?.some((g) => g.qos === 128)) {
          reject(new BambuError("NOT_FOUND", "This printer isn't available on your account.", 404));
        } else resolve();
      });
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, opts.windowMs);
      client.on("message", (_topic, payload) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(payload.toString("utf8"));
        } catch {
          return;
        }
        messages++;
        for (const [k, v] of Object.entries(msg)) {
          if (k === "print" && v && typeof v === "object" && !Array.isArray(v)) merged = mergeReport(merged, v as RawPrint);
          else other[k] = v;
        }
        const done = opts.until ? opts.until(merged, msg) : opts.full ? isFullSnapshot(merged) : false;
        if (done) {
          clearTimeout(timer);
          resolve();
        }
      });

      const seq = String(Date.now() % 1_000_000);
      if (opts.full) {
        client.publish(
          requestTopic,
          JSON.stringify({ pushing: { sequence_id: seq, command: "pushall", version: 1, push_target: 1 } }),
        );
      }
      if (opts.publish) client.publish(requestTopic, JSON.stringify(opts.publish));
    });
  } finally {
    client.end(true);
  }

  return { print: merged, messages, full: opts.full, other };
}
