// A tiny fake Moodle (login form, AJAX service, course page, files) for testing
// the Uni agents end to end. Usage: node tests/e2e/fake-moodle.mjs  (port 8082)
import http from "node:http";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<h1>Lecture 1: Supply and Demand</h1><p>Price elasticity of demand measures how much quantity demanded responds to a change in price. If price rises by 10% and quantity falls by 20%, elasticity is -2.</p><p>Consumer surplus is the area under the demand curve and above the price.</p>");
const pdf = await page.pdf();
await browser.close();

const now = Math.floor(Date.now() / 1000);
const html = (body, extra = "") => `<!doctype html><html><head><title>Fake Moodle</title><script>window.M={cfg:{sesskey:"sess123"}}</script>${extra}</head><body><div id="region-main">${body}</div></body></html>`;
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const authed = (req.headers.cookie ?? "").includes("MoodleSession=ok");
  const send = (code, body, type = "text/html", headers = {}) => { res.writeHead(code, { "Content-Type": type, ...headers }); res.end(body); };
  if (url.pathname === "/login/index.php") {
    if (req.method === "POST") {
      let b = ""; for await (const c of req) b += c;
      const p = new URLSearchParams(b);
      if (p.get("username") === "bilal" && p.get("password") === "pw") return send(303, "", "text/html", { Location: "/my/", "Set-Cookie": "MoodleSession=ok; Path=/" });
      return send(200, html('<div class="loginerrors">Invalid login</div><form method="post"><input id="username" name="username"><input id="password" name="password"><button id="loginbtn">Log in</button></form>'));
    }
    return send(200, html('<form method="post"><input id="username" name="username"><input id="password" name="password" type="password"><button id="loginbtn">Log in</button></form>'));
  }
  if (url.pathname === "/timetable.ics") return send(200, `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:tt1\r\nSUMMARY:EC1101 Lecture\r\nLOCATION:Windsor 0-03\r\nDTSTART:${new Date(Date.now() + 3600e3).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\r\nDTEND:${new Date(Date.now() + 7200e3).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z\r\nEND:VEVENT\r\nEND:VCALENDAR`, "text/calendar");
  if (url.pathname === "/jobs") return send(200, html('<h1>Spring weeks</h1><div class="job"><a href="/jobs/apply">Private Equity Spring Week 2027 - Fake Capital</a> London. Deadline 15 December 2026.</div>'));
  if (url.pathname === "/jobs/apply") return send(200, html('<h1>Apply: PE Spring Week</h1><form><label for="q1">Why are you interested in this programme?</label><textarea id="q1" required></textarea><label for="name">Full name</label><input type="text" id="name"><button type="submit">Submit</button></form>'));
  if (!authed) return send(303, "", "text/html", { Location: "/login/index.php" });
  if (url.pathname === "/my/") return send(200, html("<h2>Dashboard</h2>"));
  if (url.pathname === "/lib/ajax/service.php") {
    const info = url.searchParams.get("info");
    if (info === "core_course_get_enrolled_courses_by_timeline_classification")
      return send(200, JSON.stringify([{ error: false, data: { courses: [{ id: 1, fullname: "EC1101 Principles of Economics", shortname: "EC1101_2026-27", viewurl: "/course/view.php?id=1" }] } }]), "application/json");
    if (info === "core_calendar_get_action_events_by_timesort")
      return send(200, JSON.stringify([{ error: false, data: { events: [{ id: 501, name: "Essay 1 is due", timesort: now + 5 * 86400, url: "/mod/assign/view.php?id=12", course: { id: 1, fullname: "EC1101 Principles of Economics", shortname: "EC1101_2026-27" } }] } }]), "application/json");
  }
  if (url.pathname === "/course/view.php") return send(200, html(`
    <ul><li class="section" id="section-1"><h3 class="sectionname">Week 1: Supply and Demand</h3><ul>
      <li class="activity modtype_resource" id="module-11"><a class="aalink" href="/mod/resource/view.php?id=11"><span class="instancename">Lecture 1 slides<span class="accesshide"> File</span></span></a></li>
      <li class="activity modtype_folder" id="module-13"><a class="aalink" href="/mod/folder/view.php?id=13"><span class="instancename">Seminar materials</span></a></li>
    </ul></li>
    <li class="section" id="section-2"><h3 class="sectionname">Assessment</h3><ul>
      <li class="activity modtype_assign" id="module-12"><a class="aalink" href="/mod/assign/view.php?id=12"><span class="instancename">Essay 1</span></a></li>
    </ul></li></ul>`));
  if (url.pathname === "/mod/resource/view.php") return send(303, "", "text/html", { Location: "/pluginfile.php/1/mod_resource/content/1/Lecture%201%20slides.pdf" });
  if (url.pathname.endsWith(".pdf")) return send(200, pdf, "application/pdf");
  if (url.pathname.endsWith(".txt")) return send(200, "Problem set 1: compute the price elasticity when price rises from 10 to 12 and quantity falls from 100 to 80.", "text/plain");
  if (url.pathname === "/mod/folder/view.php") return send(200, html('<a href="/pluginfile.php/1/mod_folder/content/0/Problem%20set%201.txt?forcedownload=1">Problem set 1.txt</a>'));
  if (url.pathname === "/mod/assign/view.php") return send(200, html('<div class="activity-description" id="intro"><p>Write a 1500-word essay on whether minimum wages reduce employment. Use supply and demand diagrams and discuss elasticity of labour demand. Marking criteria: argument 40%, use of theory 40%, presentation 20%. Submit via Turnitin.</p><p>Further guidance: you should cite at least three academic sources and include a reference list.</p></div>'));
  send(404, "not found");
}).listen(8082, () => console.log("fake moodle on :8082"));
