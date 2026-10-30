// Optional custom panels shown on a sector's Overview tab.
// Add one by writing an async server component and mapping it to the sector id.
import { q } from "@/lib/db";
import { fmtTime, fmtDate } from "@/lib/time";

async function PaPanel() {
  const msgs = await q<{ id: number; ts: Date; direction: string; text: string }>("SELECT id, ts, direction, text FROM telegram_messages ORDER BY id DESC LIMIT 12");
  return (
    <section className="card">
      <h2>💬 Recent Telegram</h2>
      {msgs.length ? (
        <ul className="list">
          {msgs.map((m) => (
            <li key={m.id}>
              <span className="time">{fmtDate(m.ts)} {fmtTime(m.ts)}</span>
              <span className={`badge ${m.direction === "in" ? "info" : ""}`}>{m.direction === "in" ? "you" : "PA"}</span>
              <div className="grow" style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap" }}>{m.text.replace(/<[^>]+>/g, "").slice(0, 400)}</div>
            </li>
          ))}
        </ul>
      ) : <div className="empty">No messages yet. Link Telegram on the Setup page.</div>}
    </section>
  );
}

export const SECTOR_PANELS: Record<string, (p: { sectorId: string }) => Promise<React.ReactNode>> = {
  pa: PaPanel,
};
