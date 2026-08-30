import { getHealthStatus } from "@/lib/health";

// Nie vorrendern: Der Zustand wird bei jedem Aufruf frisch geprüft.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const health = getHealthStatus();
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
