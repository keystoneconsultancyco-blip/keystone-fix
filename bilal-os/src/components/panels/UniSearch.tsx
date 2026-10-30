"use client";
import { useState, useTransition } from "react";
import { searchCourseAction } from "@/app/actions";

type Hit = { content: string; name: string; module_code: string; week: number | null; drive_file_id: string | null; score: number };

export function UniSearch({ modules }: { modules: { code: string; name: string }[] }) {
  const [query, setQuery] = useState("");
  const [mod, setMod] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card">
      <h2>🔎 Search your course materials</h2>
      <p className="help">Finds the right slide or reading by meaning, not just exact words. Runs on your server for free.</p>
      <form
        className="row"
        style={{ flexWrap: "nowrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await searchCourseAction(query, mod);
            setErr(r.ok ? null : r.message ?? "Error");
            setHits(r.ok ? r.data : null);
          });
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. price elasticity of demand" />
        <select value={mod} onChange={(e) => setMod(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="">All modules</option>
          {modules.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
        </select>
        <button className="btn primary" disabled={pending}>{pending ? "…" : "Search"}</button>
      </form>
      {err && <p className="tone-bad help">{err}</p>}
      {hits && (hits.length ? (
        <ul className="list" style={{ marginTop: 8 }}>
          {hits.map((h, i) => (
            <li key={i} style={{ flexDirection: "column", gap: 4 }}>
              <div className="row">
                <span className="badge info">{h.module_code}{h.week !== null ? ` · wk ${h.week}` : ""}</span>
                {h.drive_file_id ? <a href={`https://drive.google.com/open?id=${h.drive_file_id}`} target="_blank" rel="noreferrer"><b>{h.name}</b></a> : <b>{h.name}</b>}
                <small className="muted">{Math.round(h.score * 100)}% match</small>
              </div>
              <div className="muted" style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{h.content}</div>
            </li>
          ))}
        </ul>
      ) : <p className="empty">No matches yet — has the indexer run?</p>)}
    </section>
  );
}
