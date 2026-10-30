// Seeds a fake bot token and pairing code for testing against fake-telegram.mjs.
import { setSecret } from "../../src/lib/settings";
import { q, pool } from "../../src/lib/db";
await setSecret("telegram_bot_token", "123456789:FAKE_TOKEN_FOR_LOCAL_TESTING_ONLY_xxxxx");
await q("DELETE FROM secrets WHERE key = 'telegram_chat_id'");
await q(`INSERT INTO agent_state (agent_id, key, value) VALUES ('system','telegram_pair',$1) ON CONFLICT (agent_id,key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ code: "PAIR1234", expires: Date.now() + 600000 })]);
await pool().end();
