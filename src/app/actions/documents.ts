"use server";

import { revalidatePath } from "next/cache";
import { addDocument, deleteDocument } from "@/lib/documents";
import { requireAuth } from "@/app/actions/auth";

export async function uploadDocument(formData: FormData): Promise<void> {
  await requireAuth();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Bitte eine Datei auswählen.");
  }
  const data = Buffer.from(await file.arrayBuffer());
  await addDocument(file.name, file.type || "application/octet-stream", data);
  revalidatePath("/dokumente");
}

export async function removeDocument(id: number): Promise<void> {
  await requireAuth();
  deleteDocument(id);
  revalidatePath("/dokumente");
}
