const http = require("node:http");
const next = require("next");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "127.0.0.1";
const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

let server;

async function start() {
  await app.prepare();
  server = http.createServer((req, res) => {
    Promise.resolve().then(() => handle(req, res)).catch(error => {
      console.error("[sodilave] pedido falhou", { name: error?.name, code: error?.code });
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Não foi possível concluir o pedido."); }
      else res.destroy();
    });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  server.maxRequestsPerSocket = 100;
  server.keepAliveTimeout = 5_000;

  server.listen(port, hostname, () => {
    console.log(`[sodilave] produção ativa em ${hostname}:${port}`);
  });
}

async function shutdown(signal) {
  console.log(`[sodilave] ${signal} recebido; a encerrar.`);
  if (!server) process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  console.error("[sodilave] erro não tratado", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[sodilave] promise rejeitada sem tratamento", reason);
  process.exit(1);
});

start().catch((error) => {
  console.error("[sodilave] falha ao arrancar", error);
  process.exit(1);
});
