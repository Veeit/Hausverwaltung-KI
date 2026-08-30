import "dotenv/config";
import { getEnv } from "@/env";
import { pollOnce } from "@/worker/processor";

let running = true;
let wake: (() => void) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
    setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
  });
}

function requestShutdown(signal: string): void {
  console.log(`[worker] ${signal} empfangen — beende nach dem aktuellen Durchlauf.`);
  running = false;
  if (wake) wake();
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

async function main(): Promise<void> {
  const env = getEnv();
  console.log("[worker] KI-Hausverwaltung — Worker gestartet.");
  console.log(`[worker] Alias: ${env.MAIL_ALIAS}`);
  console.log(`[worker] Poll-Intervall: ${env.POLL_INTERVAL_MS} ms`);

  while (running) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("[worker] Fehler im Poll-Durchlauf:", err);
    }
    if (running) {
      await sleep(env.POLL_INTERVAL_MS);
    }
  }

  console.log("[worker] Sauber beendet.");
  process.exit(0);
}

void main();
