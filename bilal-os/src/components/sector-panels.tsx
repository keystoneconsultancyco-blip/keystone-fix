// Optional custom panels shown on a sector's Overview tab.
// Add one by writing an async server component and mapping it to the sector id.
import { q } from "@/lib/db";
import { getAllSettings } from "@/lib/settings";
import { fmtTime, fmtDate, relative } from "@/lib/time";
import { InlineField, Toggle } from "./ui";
import { UniSearch } from "./panels/UniSearch";
import { saveSettingAction, toggleModuleAction } from "@/app/actions";

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

async function UniPanel() {
  const [modules, settings, rootRow] = await Promise.all([
    q<{ code: string; name: string; active: boolean; drive_folder_id: string | null; guide_doc_id: string | null; guide_updated_at: Date | null; moodle_url: string | null; files: number; indexed: number }>(
      `SELECT m.code, m.name, m.active, m.drive_folder_id, m.guide_doc_id, m.guide_updated_at, m.moodle_url,
              count(f.id)::int AS files, count(f.indexed_at)::int AS indexed
       FROM modules m LEFT JOIN course_files f ON f.module_code = m.code GROUP BY m.code ORDER BY m.code`,
    ),
    getAllSettings(),
    q<{ value: string }>("SELECT value FROM agent_state WHERE agent_id = 'uni.drive-organiser' AND key = 'rootFolderId'"),
  ]);
  const root = rootRow[0]?.value;
  return (
    <div className="stack">
      <section className="card scroll-x">
        <div className="card-head">
          <h2>📚 Modules</h2>
          {root && <a href={`https://drive.google.com/drive/folders/${root}`} target="_blank" rel="noreferrer">Open Drive folder ↗</a>}
        </div>
        {modules.length ? (
          <table className="table">
            <thead><tr><th>Sync</th><th>Module</th><th>Files</th><th>Guide</th><th>Links</th></tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.code}>
                  <td><Toggle checked={m.active} action={toggleModuleAction.bind(null, m.code)} label={`Sync ${m.code}`} /></td>
                  <td><b>{m.code}</b><div className="muted" style={{ fontSize: "0.82rem" }}>{m.name}</div></td>
                  <td>{m.files}<div className="help">{m.indexed} searchable</div></td>
                  <td>{m.guide_doc_id ? <a href={`https://docs.google.com/document/d/${m.guide_doc_id}`} target="_blank" rel="noreferrer">Guide ↗</a> : <span className="muted">not yet</span>}{m.guide_updated_at && <div className="help">{relative(m.guide_updated_at)}</div>}</td>
                  <td className="row">
                    {m.moodle_url && <a href={m.moodle_url} target="_blank" rel="noreferrer">Moodle</a>}
                    {m.drive_folder_id && <a href={`https://drive.google.com/drive/folders/${m.drive_folder_id}`} target="_blank" rel="noreferrer">Drive</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No modules yet. Add your RHUL login on the Setup page, then run “Moodle sync”.</div>}
      </section>
      <UniSearch modules={modules.filter((m) => m.active)} />
      <section className="card">
        <h2>⚙️ Uni settings</h2>
        <div className="grid cols-2">
          <InlineField label="Moodle address" value={settings["uni.moodleUrl"] as string} save={saveSettingAction.bind(null, "uni.moodleUrl")} />
          <InlineField label="Timetable iCal link" value={settings["uni.timetableIcsUrl"] as string} placeholder="webcal://… or https://….ics" help="From the RHUL timetable site (Subscribe / iCal). Leave blank and the agent will try to find it." save={saveSettingAction.bind(null, "uni.timetableIcsUrl")} />
          <InlineField label="Timetable website" value={settings["uni.timetableUrl"] as string} save={saveSettingAction.bind(null, "uni.timetableUrl")} />
          <InlineField label="Drive folder name" value={settings["uni.driveRootName"] as string} save={saveSettingAction.bind(null, "uni.driveRootName")} />
        </div>
      </section>
    </div>
  );
}

export const SECTOR_PANELS: Record<string, (p: { sectorId: string }) => Promise<React.ReactNode>> = {
  pa: PaPanel,
  uni: UniPanel,
};
