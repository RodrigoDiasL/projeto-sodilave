import nextEnv from "@next/env";

// Use the same .env/.env.local precedence as Next, including on Windows.
// Environment variables supplied by the host remain authoritative.
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
nextEnv.loadEnvConfig(process.cwd(), !production);
