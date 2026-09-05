#!/usr/bin/env node
// Startet Next.js-Server und Mail-Worker in einem einzigen Container.
// Bewusst minimal: kein s6, kein supervisord, keine Abhaengigkeiten.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const WORKER_ENTRY = "src/worker/index.ts";
// Muss unter Dockers Standard-Stop-Timeout (10s) bleiben: sonst kann Docker
// den Container per SIGKILL beenden, waehrend der Supervisor selbst noch auf
// sein eigenes Zeitlimit wartet, bevor er eskaliert.
const SHUTDOWN_TIMEOUT_MS = 8_000;

/** @type {{ name: string, child: import("node:child_process").ChildProcess, settled: boolean }[]} */
const children = [];
let shuttingDown = false;

/** Schreibt jede Zeile eines Streams mit vorangestelltem Prozessnamen weiter. */
function pipeWithPrefix(name, source, target) {
  let rest = "";
  source.setEncoding("utf8");
  source.on("data", (chunk) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) target.write(`[${name}] ${line}\n`);
  });
  source.on("end", () => {
    if (rest) target.write(`[${name}] ${rest}\n`);
    rest = "";
  });
}

function hasExited(entry) {
  return entry.settled;
}

function start(name, command, args) {
  console.log(`[supervisor] starte ${name}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipeWithPrefix(name, child.stdout, process.stdout);
  pipeWithPrefix(name, child.stderr, process.stderr);

  const entry = { name, child, settled: false };

  child.on("error", (error) => {
    entry.settled = true;
    console.error(`[supervisor] ${name} konnte nicht gestartet werden: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    entry.settled = true;
    console.log(
      `[supervisor] ${name} beendet (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    );
    // Ein Prozess allein ist nicht arbeitsfaehig: Container beenden,
    // Docker/Unraid startet ihn gemaess Restart-Policy neu.
    shutdown(typeof code === "number" ? code : 1);
  });

  children.push(entry);
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const entry of children) {
    if (!hasExited(entry)) entry.child.kill("SIGTERM");
  }

  const kill = setTimeout(() => {
    console.error("[supervisor] Zeitlimit erreicht — erzwinge SIGKILL");
    for (const entry of children) {
      if (!hasExited(entry)) entry.child.kill("SIGKILL");
    }
    clearInterval(poll);
    clearTimeout(kill);
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS);

  const poll = setInterval(() => {
    if (children.every(hasExited)) {
      clearInterval(poll);
      clearTimeout(kill);
      process.exit(exitCode);
    }
  }, 100);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[supervisor] ${signal} empfangen — fahre Prozesse herunter`);
    shutdown(0);
  });
}

start("web", "./node_modules/.bin/next", ["start"]);

if (process.env.RUN_WORKER === "0") {
  console.log("[supervisor] Worker deaktiviert (RUN_WORKER=0)");
} else if (existsSync(WORKER_ENTRY)) {
  start("worker", process.execPath, ["--import", "tsx", WORKER_ENTRY]);
} else {
  console.log(`[supervisor] ${WORKER_ENTRY} nicht vorhanden — starte nur das Dashboard`);
}
