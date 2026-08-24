const failures = [];

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) failures.push(`${name} não está definido.`);
  return value;
};

const databaseUrl = required("DATABASE_URL");
const sessionSecret = required("SESSION_SECRET");
const appUrl = required("APP_URL");

if (databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "mysql:") failures.push("DATABASE_URL deve usar o protocolo mysql://.");
    if (!parsed.username || !parsed.hostname || !parsed.pathname || parsed.pathname === "/") failures.push("DATABASE_URL está incompleto.");
  } catch {
    failures.push("DATABASE_URL não é um URL válido.");
  }
}

if (sessionSecret && sessionSecret.length < 32) failures.push("SESSION_SECRET deve ter pelo menos 32 caracteres.");

if (appUrl) {
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== "https:") failures.push("APP_URL deve usar HTTPS em produção.");
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) failures.push("APP_URL deve conter apenas a origem da aplicação, sem caminho, query ou hash.");
    const host = parsed.hostname.toLowerCase();
    if (host === "sodilave.pt" || host === "www.sodilave.pt") {
      failures.push("O domínio principal e www.sodilave.pt estão reservados ao website institucional. Use um subdomínio separado para a aplicação.");
    }
  } catch {
    failures.push("APP_URL não é um URL válido.");
  }
}

if (process.env.INITIAL_ADMIN_PIN && !/^\d{8}$/.test(process.env.INITIAL_ADMIN_PIN)) {
  failures.push("INITIAL_ADMIN_PIN, quando definido, deve ter exatamente 8 algarismos.");
}

if (process.env.BACKUP_RETENTION_DAYS) {
  const days = Number(process.env.BACKUP_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 3650) failures.push("BACKUP_RETENTION_DAYS deve ser um número inteiro entre 1 e 3650.");
}

if (failures.length) {
  console.error("Configuração de produção inválida:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("Configuração de produção validada com sucesso.");
