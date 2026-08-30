import "dotenv/config";
import { pathToFileURL } from "node:url";
import { getEnv } from "@/env";
import { reportStartupError } from "@/lib/startupError";
import { pollOnce, resetStuckProcessingMessages } from "@/worker/processor";

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

export async function main(): Promise<void> {
  const env = getEnv();
  console.log("[worker] KI-Hausverwaltung — Worker gestartet.");
  console.log(`[worker] Alias: ${env.MAIL_ALIAS}`);
  console.log(`[worker] Poll-Intervall: ${env.POLL_INTERVAL_MS} ms`);

  // Ein vorheriger Prozess kann mitten in einem Agent-Lauf abgestürzt sein
  // (das größte Zeitfenster im System) und dabei Nachrichten in 'processing'
  // zurückgelassen haben. Ohne diesen Reset blieben sie für immer hängen.
  const resetCount = resetStuckProcessingMessages();
  if (resetCount > 0) {
    console.log(
      `[worker] ${resetCount} Nachricht(en) waren nach einem vorherigen Abbruch in ` +
        `'processing' hängen geblieben und wurden auf 'pending' zurückgesetzt.`,
    );
  }

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

// Nur ausfuehren, wenn diese Datei direkt gestartet wurde (`npm run worker`,
// intern `tsx src/worker/index.ts`) — nicht beim Import in Tests. Fehler aus
// main() (z. B. eine EnvValidationError, wenn die .env noch unvollstaendig
// ist) werden hier abgefangen: reportStartupError() gibt bei einem
// Konfigurationsfehler nur die aufbereitete deutsche Meldung aus (kein
// Stacktrace), bei jedem anderen Fehler bleibt der Stack fuer die
// Fehlersuche erhalten. Der Prozess beendet sich in beiden Faellen mit
// Exit-Code 1, damit eine Neustart-Schleife (siehe README) den Abbruch
// erkennt.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    reportStartupError(err);
    process.exit(1);
  });
}
