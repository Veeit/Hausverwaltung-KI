"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { contractors, properties, tenants } from "@/db/schema";
import { requireAuth } from "@/app/actions/auth";

// --- Validierungsschemata (lokal, nicht exportiert) ---

const propertySchema = z.object({
  address: z.string().min(1, "Adresse darf nicht leer sein."),
});

const tenantSchema = z.object({
  name: z.string().min(1, "Name darf nicht leer sein."),
  email: z.string().email("Bitte eine gültige E-Mail-Adresse angeben."),
  propertyId: z.coerce
    .number({ invalid_type_error: "Bitte ein Objekt auswählen." })
    .int("Bitte ein Objekt auswählen.")
    .positive("Bitte ein Objekt auswählen."),
  unitLabel: z.string(),
  phone: z.string(),
});

const contractorSchema = z.object({
  name: z.string().min(1, "Name darf nicht leer sein."),
  email: z.string().email("Bitte eine gültige E-Mail-Adresse angeben."),
  trade: z.string().min(1, "Gewerk darf nicht leer sein."),
  notes: z.string(),
});

// --- Lokale Helfer ---

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  }
  return result.data;
}

function deleteOrThrow(run: () => void, conflictMessage: string): void {
  try {
    run();
  } catch (err) {
    // better-sqlite3 wirft bei referenzierten Zeilen "FOREIGN KEY constraint failed".
    if (String(err).includes("FOREIGN KEY")) {
      throw new Error(conflictMessage);
    }
    throw err;
  }
}

// --- Objekte ---

export async function createProperty(formData: FormData): Promise<void> {
  await requireAuth();
  const data = parseOrThrow(propertySchema, { address: field(formData, "address") });
  getDb().insert(properties).values({ address: data.address }).run();
  revalidatePath("/stammdaten/objekte");
}

export async function updateProperty(id: number, formData: FormData): Promise<void> {
  await requireAuth();
  const data = parseOrThrow(propertySchema, { address: field(formData, "address") });
  getDb()
    .update(properties)
    .set({ address: data.address })
    .where(eq(properties.id, id))
    .run();
  revalidatePath("/stammdaten/objekte");
}

export async function deleteProperty(id: number): Promise<void> {
  await requireAuth();
  deleteOrThrow(
    () => getDb().delete(properties).where(eq(properties.id, id)).run(),
    "Objekt kann nicht gelöscht werden: Es sind noch Mieter zugeordnet.",
  );
  revalidatePath("/stammdaten/objekte");
}

// --- Mieter ---

function tenantValues(formData: FormData) {
  const data = parseOrThrow(tenantSchema, {
    name: field(formData, "name"),
    email: field(formData, "email"),
    propertyId: field(formData, "propertyId"),
    unitLabel: field(formData, "unitLabel"),
    phone: field(formData, "phone"),
  });
  return {
    name: data.name,
    email: data.email.toLowerCase(),
    propertyId: data.propertyId,
    unitLabel: data.unitLabel === "" ? null : data.unitLabel,
    phone: data.phone === "" ? null : data.phone,
  };
}

export async function createTenant(formData: FormData): Promise<void> {
  await requireAuth();
  getDb().insert(tenants).values(tenantValues(formData)).run();
  revalidatePath("/stammdaten/mieter");
}

export async function updateTenant(id: number, formData: FormData): Promise<void> {
  await requireAuth();
  getDb().update(tenants).set(tenantValues(formData)).where(eq(tenants.id, id)).run();
  revalidatePath("/stammdaten/mieter");
}

export async function deleteTenant(id: number): Promise<void> {
  await requireAuth();
  deleteOrThrow(
    () => getDb().delete(tenants).where(eq(tenants.id, id)).run(),
    "Mieter kann nicht gelöscht werden: Es existieren noch Vorgänge zu diesem Mieter.",
  );
  revalidatePath("/stammdaten/mieter");
}

// --- Handwerker ---

function contractorValues(formData: FormData) {
  const data = parseOrThrow(contractorSchema, {
    name: field(formData, "name"),
    email: field(formData, "email"),
    trade: field(formData, "trade"),
    notes: field(formData, "notes"),
  });
  return {
    name: data.name,
    email: data.email.toLowerCase(),
    trade: data.trade,
    notes: data.notes === "" ? null : data.notes,
  };
}

export async function createContractor(formData: FormData): Promise<void> {
  await requireAuth();
  getDb().insert(contractors).values(contractorValues(formData)).run();
  revalidatePath("/stammdaten/handwerker");
}

export async function updateContractor(id: number, formData: FormData): Promise<void> {
  await requireAuth();
  getDb()
    .update(contractors)
    .set(contractorValues(formData))
    .where(eq(contractors.id, id))
    .run();
  revalidatePath("/stammdaten/handwerker");
}

export async function deleteContractor(id: number): Promise<void> {
  await requireAuth();
  deleteOrThrow(
    () => getDb().delete(contractors).where(eq(contractors.id, id)).run(),
    "Handwerker kann nicht gelöscht werden: Es existieren noch Vorgänge oder Genehmigungen zu diesem Handwerker.",
  );
  revalidatePath("/stammdaten/handwerker");
}
