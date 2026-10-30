"use client";
import { useState, useTransition } from "react";
import { telegramPairAction } from "../../actions";

export function TelegramPair({ linked }: { linked: boolean }) {
  const [res, setRes] = useState<{ ok: boolean; message?: string; data?: any } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button className="btn primary" disabled={pending} onClick={() => start(async () => setRes(await telegramPairAction()))}>
        {linked ? "Re-link Telegram" : "Link my Telegram"}
      </button>
      {linked && !res && <span className="badge good" style={{ marginLeft: 8 }}>linked</span>}
      {res && !res.ok && <div className="tone-bad help">{res.message}</div>}
      {res?.ok && (
        <div className="notice" style={{ marginTop: 8 }}>
          Open <a href={res.data.link} target="_blank" rel="noreferrer">t.me/{res.data.username}</a> on your phone and press <b>Start</b>
          {" "}(or send <code>/start {res.data.code}</code>). The code works for 15 minutes. The worker must be running.
        </div>
      )}
    </div>
  );
}
