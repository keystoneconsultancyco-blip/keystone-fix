import path from "node:path";

// The only configuration read from environment variables. Everything else is
// entered on the Setup page and stored (encrypted where secret) in Postgres.
export const env = {
  get databaseUrl() {
    const v = process.env.DATABASE_URL;
    if (!v) throw new Error("DATABASE_URL is not set");
    return v;
  },
  get masterKey() {
    return process.env.MASTER_KEY ?? "";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get dataDir() {
    return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./data");
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
};
