"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client";
import { CATEGORIES, type DesignCard, type Feed, type NavKey } from "@/lib/makerworld";

const PAGE = 24;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="mw-stat">
      <b>{compact(value)}</b>
      <span>{label}</span>
    </span>
  );
}

function Card({ d }: { d: DesignCard }) {
  return (
    <a className="mw-card" href={`/makerworld/${d.id}`} aria-labelledby={`mw-${d.id}`}>
      <div className="mw-thumb">
        {d.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="mw-thumb-empty" aria-hidden="true" />
        )}
        {d.official && <span className="mw-flag">Bambu</span>}
        {d.printCount > 0 && <span className="mw-prints">{compact(d.printCount)} printed</span>}
      </div>
      <div className="mw-body">
        <h3 id={`mw-${d.id}`}>{d.title}</h3>
        <p className="mw-creator">
          {d.creatorAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.creatorAvatar} alt="" width={22} height={22} loading="lazy" referrerPolicy="no-referrer" />
          )}
          <span>{d.creator}</span>
        </p>
        <div className="mw-stats">
          <Stat value={d.likeCount} label="likes" />
          <Stat value={d.downloadCount} label="downloads" />
        </div>
      </div>
    </a>
  );
}

export default function MakerWorldBrowser() {
  const [nav, setNav] = useState<NavKey>("Trending");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(""); // the keyword actually searched
  const [designs, setDesigns] = useState<DesignCard[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (nextOffset: number, mode: "replace" | "append") => {
      const mine = ++reqId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ offset: String(nextOffset), limit: String(PAGE) });
      if (submitted) params.set("q", submitted);
      else params.set("nav", nav);
      try {
        const feed = await api<Feed>(`/api/makerworld?${params.toString()}`);
        if (mine !== reqId.current) return; // a newer request superseded this one
        setTotal(feed.total);
        setOffset(nextOffset + feed.designs.length);
        setDesigns((prev) => (mode === "append" ? [...prev, ...feed.designs] : feed.designs));
      } catch (e) {
        if (mine !== reqId.current) return;
        setError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Couldn't load MakerWorld.", 0));
      } finally {
        if (mine === reqId.current) setLoading(false);
      }
    },
    [nav, submitted],
  );

  // Reload whenever the category or the submitted search changes.
  useEffect(() => {
    setDesigns([]);
    setOffset(0);
    fetchPage(0, "replace");
  }, [fetchPage]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  const clearSearch = () => {
    setQuery("");
    setSubmitted("");
  };

  const hasMore = designs.length < total;

  return (
    <div className="stack">
      <div className="mw-head">
        <div>
          <h1 style={{ margin: 0 }}>Browse MakerWorld</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Find a model, pick a ready-sliced profile, and send it to a printer — no desktop slicer needed.
          </p>
        </div>
        <form className="mw-search" role="search" onSubmit={onSearch}>
          <input
            type="search"
            inputMode="search"
            placeholder="Search models, e.g. “articulated dragon”"
            aria-label="Search MakerWorld"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={loading && !designs.length}>
            Search
          </button>
        </form>
      </div>

      {submitted ? (
        <div className="row">
          <span className="badge info">Results for “{submitted}”</span>
          <button className="btn btn-ghost" type="button" onClick={clearSearch}>
            Back to categories
          </button>
        </div>
      ) : (
        <div className="mw-chips" role="tablist" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={nav === c.key}
              className={`mw-chip${nav === c.key ? " is-active" : ""}`}
              onClick={() => setNav(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="alert bad" role="alert">
          <h2>{error.code === "UPSTREAM_BLOCKED" ? "MakerWorld refused the request" : "Couldn’t load MakerWorld"}</h2>
          <p>{error.message}</p>
        </div>
      )}

      {designs.length === 0 && loading && (
        <div className="mw-grid" aria-busy="true" aria-label="Loading designs">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ minHeight: 260 }} />
          ))}
        </div>
      )}

      {designs.length === 0 && !loading && !error && (
        <div className="card">
          <h2>Nothing here</h2>
          <p className="muted">
            {submitted ? "No models matched your search. Try different words." : "This category is empty right now."}
          </p>
        </div>
      )}

      {designs.length > 0 && (
        <ul className="mw-grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {designs.map((d) => (
            <li key={d.id}>
              <Card d={d} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn" type="button" onClick={() => fetchPage(offset, "append")} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <p className="muted small">
        Models and profiles are hosted by MakerWorld. Printing a profile needs a printer on your account and firmware
        that accepts third-party commands. <a href="/privacy#firmware">What does that mean?</a>
      </p>
    </div>
  );
}
