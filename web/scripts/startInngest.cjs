const { loadEnvConfig } = require("@next/env"),
  { spawn } = require("node:child_process");
loadEnvConfig(process.cwd());
if (!process.env.AUTH_WORKER_TOKEN)
  throw Error("Run the brand-auth setup first.");
const url =
  (process.env.APP_URL || "http://localhost:3001") +
  "/api/inngest?workerToken=" +
  process.env.AUTH_WORKER_TOKEN;
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["inngest-cli", "dev", "-u", url],
  { stdio: "inherit", shell: process.platform === "win32" },
);
child.on("exit", (code) => (process.exitCode = code || 0));
