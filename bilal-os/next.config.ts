import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss", "playwright", "@huggingface/transformers", "grammy", "googleapis"],
  poweredByHeader: false,
};

export default config;
