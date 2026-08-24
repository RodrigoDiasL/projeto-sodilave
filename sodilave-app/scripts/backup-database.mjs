import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const rawUrl = String(process.env.DATABASE_URL || "").trim();
if (!rawUrl) throw new Error("DATABASE_URL não está definido.");

const url = new URL(rawUrl);
if (url.protocol !== "mysql:") throw new Error("DATABASE_URL deve usar mysql://.");

const host = url.hostname || "localhost";
const port = url.port || "3306";
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!user || !database) throw new Error("DATABASE_URL está incompleto.");

const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), "backups", "database"));
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || "30");
if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("BACKUP_RETENTION_DAYS é inválido.");

await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
const filename = `sodilave-${stamp}.sql.gz`;
const target = path.join(backupDir, filename);
const dumpBinary = process.env.MYSQLDUMP_BIN || "mysqldump";

const args = [
  `--host=${host}`,
  `--port=${port}`,
  `--user=${user}`,
  "--single-transaction",
  "--quick",
  "--skip-lock-tables",
  "--default-character-set=utf8mb4",
  database,
];

const child = spawn(dumpBinary, args, {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

const exitPromise = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `mysqldump terminou com código ${code}.`)));
});

try {
  await Promise.all([
    pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(target, { mode: 0o600 })),
    exitPromise,
  ]);
} catch (error) {
  await fs.rm(target, { force: true });
  throw error;
}

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of await fs.readdir(backupDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/^sodilave-.*\.sql\.gz$/.test(entry.name)) continue;
  const filePath = path.join(backupDir, entry.name);
  const stat = await fs.stat(filePath);
  if (stat.mtimeMs < cutoff) await fs.rm(filePath, { force: true });
}

console.log(`Backup concluído: ${target}`);
