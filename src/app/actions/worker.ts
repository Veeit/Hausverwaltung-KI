"use server";

import { revalidatePath } from "next/cache";
import { resumeWorker } from "@/lib/rateLimit";
import { requireAuth } from "@/app/actions/auth";

export async function resumeWorkerAction(): Promise<void> {
  await requireAuth();
  resumeWorker();
  revalidatePath("/");
}
