import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const schemaPath = path.join(projectRoot, "prisma", "schema.prisma");
const tail = (value, size = 7000) => String(value || "").slice(-size);

function run(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, NO_COLOR: "1", PRISMA_DISABLE_WARNINGS: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log(`\n=== ${label} ===`);
  console.log(`status: ${result.status}`);
  if (result.error) console.log(`spawn error: ${result.error.message}`);
  if (result.stdout) console.log(`stdout (fim):\n${tail(result.stdout)}`);
  if (result.stderr) console.log(`stderr (fim):\n${tail(result.stderr)}`);
  return result.status === 0;
}

console.log("Diagnóstico Prisma / cPanel");
console.log(`Node: ${process.version}`);
console.log(`execPath: ${process.execPath}`);
console.log(`platform: ${process.platform} ${process.arch}`);
console.log(`cwd: ${projectRoot}`);
console.log(`schema existe: ${fs.existsSync(schemaPath)}`);

let prismaPkg;
let cliPath;
try {
  prismaPkg = require.resolve("prisma/package.json");
  cliPath = path.join(path.dirname(prismaPkg), "build", "index.js");
  console.log(`prisma package: ${prismaPkg}`);
  console.log(`prisma cli: ${cliPath}`);
  console.log(`prisma cli existe: ${fs.existsSync(cliPath)}`);
} catch (error) {
  console.error("Não foi possível resolver o pacote prisma:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const syntaxOk = run("node --check prisma CLI", ["--check", cliPath]);
const versionOk = run("prisma -v", [cliPath, "-v"]);
const generateOk = run("prisma generate", [cliPath, "generate", "--schema", schemaPath, "--no-hints"]);

if (syntaxOk && versionOk && generateOk) {
  console.log("\nDiagnóstico concluído: Prisma CLI e generate funcionam.");
  process.exit(0);
}

console.log("\nDiagnóstico concluído com falha. Copie apenas este resultado; ele já contém somente o fim útil do erro.");
process.exit(1);
