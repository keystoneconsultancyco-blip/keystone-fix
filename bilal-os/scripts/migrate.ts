import { migrate } from "../src/lib/migrate";
import { pool } from "../src/lib/db";

const applied = await migrate();
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database already up to date");
await pool().end();
