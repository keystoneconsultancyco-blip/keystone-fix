import { searchCourse } from "../../src/agents/uni/indexer";
import { pool } from "../../src/lib/db";
for (const r of await searchCourse(process.argv[2] ?? "how responsive is demand to price", undefined, 3)) console.log(r.score.toFixed(2), r.name);
await pool().end();
