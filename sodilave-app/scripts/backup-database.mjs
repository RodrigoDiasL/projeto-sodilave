import "./load-env.mjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
for (const publicFolder of ["public", ".next"]) {
  const relative = path.relative(path.resolve(publicFolder), backupDir);
  if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("BACKUP_DIR não pode ficar numa pasta publicada pela aplicação.");
  }
}
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || "30");
if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("BACKUP_RETENTION_DAYS é inválido.");

function resolveDumpBinary() {
  if (process.env.MYSQLDUMP_BIN) return process.env.MYSQLDUMP_BIN;
  for (const candidate of ["mysqldump", "mariadb-dump"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("Não foi encontrado mysqldump nem mariadb-dump no servidor. Defina MYSQLDUMP_BIN com o caminho correto.");
}

await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
const filename = `sodilave-${stamp}-${randomUUID().slice(0,8)}.sql.gz`;
const target = path.join(backupDir, filename);
const temporary = target + ".partial";
const dumpBinary = resolveDumpBinary();

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
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });

const exitPromise = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${dumpBinary} terminou com código ${code}.`)));
});

const copyPromise = pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(temporary, { mode: 0o600, flags: "wx" }));
try {
  await Promise.all([copyPromise, exitPromise]);
  await fs.rename(temporary, target);
} catch (error) {
  child.kill();
  await Promise.allSettled([copyPromise, exitPromise]);
  await fs.rm(temporary, { force: true });
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
