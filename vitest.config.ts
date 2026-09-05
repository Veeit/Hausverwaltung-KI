import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Git-Worktrees liegen unter .claude/worktrees/ INNERHALB des Repos. Ohne
    // diesen Ausschluss sammelt vitest deren Testdateien mit ein: die Suite
    // laeuft doppelt, und die Kopien scheitern, weil der Alias @/ auf das src/
    // des Hauptbaums zeigt statt auf ihr eigenes.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
});
