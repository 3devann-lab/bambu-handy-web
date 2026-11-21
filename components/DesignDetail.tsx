"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, api, formatDuration } from "@/lib/client";
import { isCompatible, summaryText, type DesignDetail as Design, type Instance } from "@/lib/makerworld";
import type { PrinterSummary } from "@/lib/types";
import PrintDialog from "@/components/PrintDialog";

function FilamentSwatches({ instance }: { instance: Instance }) {
  const fils = instance.plates[0]?.filaments.length ? instance.plates[0].filaments : instance.filaments;
  if (!fils.length) return null;
  return (
    <span className="fil-swatches" aria-label={`${fils.length} filament${fils.length > 1 ? "s" : ""}`}>
      {fils.slice(0, 6).map((f, i) => (
        <span
          key={i}
          className="fil-dot"
          style={{ background: f.color ?? "transparent" }}
          title={`${f.type}${f.color ? ` ${f.color}` : ""}`}
        />
      ))}
    </span>
  );
}

function ProfileRow({
  design,
  instance,
  printers,
  onPrint,
}: {
  design: Design;
  instance: Instance;
  printers: PrinterSummary[];
  onPrint: (instance: Instance) => void;
}) {
  const compatible = printers.filter((p) => isCompatible(p.modelCode, p.nozzleDiameter, instance));
  const canPrint = instance.appCanPrint && compatible.length > 0;
  const thumb = instance.plates[0]?.thumbnail || instance.cover;

  return (
    <li className="profile-row">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="profile-thumb" src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="profile-thumb profile-thumb-empty" aria-hidden="true" />
      )}
      <div className="profile-main">
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ overflowWrap: "anywhere" }}>{instance.title}</strong>
          {instance.isDefault && <span className="badge dim">Default</span>}
        </div>
        <dl className="kv profile-kv">
          <dt>Time</dt>
          <dd>{formatDuration(instance.prediction)}</dd>
          <dt>Filament</dt>
          <dd>
            {instance.weight != null ? `${Math.round(instance.weight)} g` : "–"}
            {instance.materialCount && instance.materialCount > 1 ? ` · ${instance.materialCount} colors` : ""}
          </dd>
        </dl>
        <div className="row" style={{ gap: 10 }}>
          <FilamentSwatches instance={instance} />
          {compatible.length > 0 ? (
            <span className="badge ok">Fits {compatible.map((p) => p.name).join(", ")}</span>
          ) : (
            <span className="badge dim">Not sliced for your printers</span>
          )}
          {instance.needAms && <span className="badge info">AMS</span>}
        </div>
      </div>
      <div className="profile-action">
        <button className="btn btn-primary" type="button" onClick={() => onPrint(instance)} disabled={!canPrint}>
          Print
        </button>
        {!instance.appCanPrint && <span className="muted small">Not app-printable</span>}
      </div>
    </li>
  );
}

export default function DesignDetail({ id }: { id: number }) {
  const [design, setDesign] = useState<Design | null>(null);
  const [printers, setPrinters] = useState<PrinterSummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<Instance | null>(null);
  const [hero, setHero] = useState<string>("");

  useEffect(() => {
    api<{ design: Design }>(`/api/makerworld/${id}`)
      .then((r) => {
        setDesign(r.design);
        setHero(r.design.cover || r.design.pictures[0] || "");
      })
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Couldn’t load this design.", 0)));
    api<{ printers: PrinterSummary[] }>("/api/printers")
      .then((r) => setPrinters(r.printers))
      .catch(() => setPrinters([]));
  }, [id]);

  const instances = useMemo(() => {
    if (!design) return [];
    return [...design.instances].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }, [design]);

  const shown = showAll ? instances : instances.slice(0, 8);
  const gallery = design ? [design.cover, ...design.pictures].filter(Boolean) : [];

  if (error) {
    return (
      <div className="stack">
        <a className="btn btn-ghost" href="/makerworld" style={{ alignSelf: "flex-start" }}>
          ← MakerWorld
        </a>
        <div className="alert bad" role="alert">
          <h2>{error.code === "NOT_FOUND" ? "Design not found" : "Couldn’t load this design"}</h2>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  if (!design) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ minHeight: 320 }} />
        <div className="skeleton" style={{ minHeight: 200 }} />
      </div>
    );
  }

  return (
    <div className="stack">
      <a className="btn btn-ghost" href="/makerworld" style={{ alignSelf: "flex-start" }}>
        ← MakerWorld
      </a>

      <div className="design-head">
        <div className="design-media">
          <div className="design-hero">
            {hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero} alt={design.title} referrerPolicy="no-referrer" />
            ) : (
              <span className="mw-thumb-empty" aria-hidden="true" />
            )}
          </div>
          {gallery.length > 1 && (
            <div className="design-thumbs" role="group" aria-label="Pictures">
              {gallery.slice(0, 6).map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`design-thumb${src === hero ? " is-active" : ""}`}
                  onClick={() => setHero(src)}
                  aria-label="Show picture"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="design-info stack">
          <div>
            <h1 style={{ marginBottom: 6 }}>{design.title}</h1>
            <p className="design-creator">
              {design.creatorAvatar && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={design.creatorAvatar} alt="" width={28} height={28} referrerPolicy="no-referrer" />
              )}
              <span>by {design.creator}</span>
              {design.official && <span className="badge info">Bambu Lab</span>}
            </p>
          </div>
          <dl className="design-stats">
            <div>
              <dt>Prints</dt>
              <dd>{design.printCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Likes</dt>
              <dd>{design.likeCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Downloads</dt>
              <dd>{design.downloadCount.toLocaleString()}</dd>
            </div>
          </dl>
          {design.license && <p className="muted small" style={{ margin: 0 }}>License: {design.license}</p>}
          <a
            className="btn btn-ghost"
            href={`https://makerworld.com/en/models/${design.id}`}
            target="_blank"
            rel="noreferrer noopener"
            style={{ alignSelf: "flex-start" }}
          >
            Open on MakerWorld ↗
          </a>
        </div>
      </div>

      {design.summaryHtml && (
        <section className="card">
          <h2>About</h2>
          <p style={{ whiteSpace: "pre-line", margin: 0 }}>{summaryText(design.summaryHtml)}</p>
        </section>
      )}

      <section className="card stack" aria-labelledby="profiles-h">
        <div className="row">
          <h2 id="profiles-h" style={{ margin: 0 }}>
            Print profiles
          </h2>
          <span className="spacer" />
          <span className="muted small">{instances.length} available</span>
        </div>
        {instances.length === 0 ? (
          <p className="muted">This model has no ready-to-print profiles. Open it on MakerWorld to prepare one.</p>
        ) : (
          <>
            {printers.length === 0 && (
              <div className="alert info">
                <p style={{ margin: 0 }}>
                  No printers on your account yet. You can still browse profiles — bind a printer in Bambu Handy to
                  print one.
                </p>
              </div>
            )}
            <ul className="profile-list">
              {shown.map((inst) => (
                <ProfileRow key={inst.id} design={design} instance={inst} printers={printers} onPrint={setActive} />
              ))}
            </ul>
            {instances.length > shown.length && (
              <button className="btn" type="button" onClick={() => setShowAll(true)}>
                Show all {instances.length} profiles
              </button>
            )}
          </>
        )}
      </section>

      {active && (
        <PrintDialog
          design={design}
          instance={active}
          printers={printers.filter((p) => isCompatible(p.modelCode, p.nozzleDiameter, active))}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
