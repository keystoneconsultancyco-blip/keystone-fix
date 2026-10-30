// Points the Uni agents at fake-moodle.mjs.
import { setSecret, setSetting } from "../../src/lib/settings";
import { pool } from "../../src/lib/db";
await setSecret("moodle_username", "bilal");
await setSecret("moodle_password", "pw");
await setSetting("uni.moodleUrl", "http://localhost:8082");
await setSetting("uni.timetableIcsUrl", "http://localhost:8082/timetable.ics");
await pool().end();
