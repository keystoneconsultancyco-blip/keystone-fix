import { setSecret } from "../../src/lib/settings";
import { pool } from "../../src/lib/db";
await setSecret("anthropic_api_key", "sk-ant-fake-local-testing");
await pool().end();
