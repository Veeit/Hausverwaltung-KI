"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { contractors, properties, tenants } from "@/db/schema";
import { requireAuth } from "@/app/actions/auth";
import { OK, fail, type ActionResult } from "@/lib/actionResult";

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

// ok:true/false als expliziter Diskriminant (statt eines optionalen "error"-
// Felds): TypeScript engt bei einem rein optionalen Unterscheidungsmerkmal
// ("error?: undefined" vs. "error: string") den Typ nach einer Prüfung wie
// `if (validated.error)` NICHT zuverlässig ein — `validated.data` bliebe im
// Erfolgsfall als "possibly undefined" gemeldet, obwohl der Fehlerfall bereits
// per return ausgeschlossen wurde.
type Validated<T> = { ok: true; data: T } | { ok: false; error: string };

// Validiert gegen ein Zod-Schema und liefert das Ergebnis als Wert statt zu
// werfen (siehe src/lib/actionResult.ts) — die deutsche Meldung aus dem
// Schema muss beim Vermieter ankommen, nicht durch Next.js' Redaktion
// geworfener Server-Action-Fehler im Produktionsbuild verschluckt werden.
function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): Validated<z.infer<S>> {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((issue) => issue.message).join(" ") };
  }
  return { ok: true, data: result.data };
}

// Führt einen löschenden DB-Zugriff aus und übersetzt einen FOREIGN-KEY-
// Konflikt (referenzierte Zeilen existieren noch) in eine deutsche
// Fehlermeldung als Rückgabewert.
function runDelete(run: () => void, conflictMessage: string): ActionResult {
  try {
    run();
  } catch (err) {
    // better-sqlite3 wirft bei referenzierten Zeilen "FOREIGN KEY constraint failed".
    if (String(err).includes("FOREIGN KEY")) {
      return fail(conflictMessage);
    }
    throw err;
  }
  return OK;
}

// Analog zu runDelete, aber für Anlegen/Ändern: Dort kann statt eines
// FOREIGN-KEY-Konflikts (referenziertes Objekt existiert nicht (mehr), z. B.
// propertyId eines gelöschten Objekts) auch ein UNIQUE-Konflikt auftreten
// (bereits vergebene E-Mail-Adresse bei tenants/contractors). Beides wird in
// eine verständliche deutsche Meldung übersetzt; alle anderen Fehler werden
// unverändert weitergeworfen, damit unbekannte Fehler nicht verschluckt werden
// (sie landen dann bewusst auf der globalen Error-Boundary).
function runWrite(
  run: () => void,
  messages: { emailTaken: string; referenceMissing?: string },
): ActionResult {
  try {
    run();
  } catch (err) {
    const text = String(err);
    if (text.includes("UNIQUE constraint failed")) {
      return fail(messages.emailTaken);
    }
    if (messages.referenceMissing && text.includes("FOREIGN KEY constraint failed")) {
      return fail(messages.referenceMissing);
    }
    throw err;
  }
  return OK;
}

// --- Objekte ---

export async function createProperty(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = validate(propertySchema, { address: field(formData, "address") });
  if (!validated.ok) return fail(validated.error);
  getDb().insert(properties).values({ address: validated.data.address }).run();
  revalidatePath("/stammdaten/objekte");
  return OK;
}

export async function updateProperty(id: number, formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = validate(propertySchema, { address: field(formData, "address") });
  if (!validated.ok) return fail(validated.error);
  getDb()
    .update(properties)
    .set({ address: validated.data.address })
    .where(eq(properties.id, id))
    .run();
  revalidatePath("/stammdaten/objekte");
  return OK;
}

export async function deleteProperty(id: number): Promise<ActionResult> {
  await requireAuth();
  const result = runDelete(
    () => getDb().delete(properties).where(eq(properties.id, id)).run(),
    "Objekt kann nicht gelöscht werden: Es sind noch Mieter zugeordnet.",
  );
  if (result.error) return result;
  revalidatePath("/stammdaten/objekte");
  return OK;
}

// --- Mieter ---

function tenantValues(formData: FormData): Validated<{
  name: string;
  email: string;
  propertyId: number;
  unitLabel: string | null;
  phone: string | null;
}> {
  const validated = validate(tenantSchema, {
    name: field(formData, "name"),
    email: field(formData, "email"),
    propertyId: field(formData, "propertyId"),
    unitLabel: field(formData, "unitLabel"),
    phone: field(formData, "phone"),
  });
  if (!validated.ok) return validated;
  const data = validated.data;
  return {
    ok: true,
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      propertyId: data.propertyId,
      unitLabel: data.unitLabel === "" ? null : data.unitLabel,
      phone: data.phone === "" ? null : data.phone,
    },
  };
}

const TENANT_EMAIL_TAKEN =
  "Diese E-Mail-Adresse ist bereits einem anderen Mieter zugeordnet. Bitte eine andere E-Mail-Adresse verwenden oder den bestehenden Mieter bearbeiten.";
const TENANT_PROPERTY_MISSING =
  "Das ausgewählte Objekt existiert nicht mehr. Bitte die Seite neu laden und ein gültiges Objekt auswählen.";

export async function createTenant(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = tenantValues(formData);
  if (!validated.ok) return fail(validated.error);
  const result = runWrite(() => getDb().insert(tenants).values(validated.data).run(), {
    emailTaken: TENANT_EMAIL_TAKEN,
    referenceMissing: TENANT_PROPERTY_MISSING,
  });
  if (result.error) return result;
  revalidatePath("/stammdaten/mieter");
  return OK;
}

export async function updateTenant(id: number, formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = tenantValues(formData);
  if (!validated.ok) return fail(validated.error);
  const result = runWrite(
    () => getDb().update(tenants).set(validated.data).where(eq(tenants.id, id)).run(),
    { emailTaken: TENANT_EMAIL_TAKEN, referenceMissing: TENANT_PROPERTY_MISSING },
  );
  if (result.error) return result;
  revalidatePath("/stammdaten/mieter");
  return OK;
}

export async function deleteTenant(id: number): Promise<ActionResult> {
  await requireAuth();
  const result = runDelete(
    () => getDb().delete(tenants).where(eq(tenants.id, id)).run(),
    "Mieter kann nicht gelöscht werden: Es existieren noch Vorgänge zu diesem Mieter.",
  );
  if (result.error) return result;
  revalidatePath("/stammdaten/mieter");
  return OK;
}

// --- Handwerker ---

function contractorValues(formData: FormData): Validated<{
  name: string;
  email: string;
  trade: string;
  notes: string | null;
}> {
  const validated = validate(contractorSchema, {
    name: field(formData, "name"),
    email: field(formData, "email"),
    trade: field(formData, "trade"),
    notes: field(formData, "notes"),
  });
  if (!validated.ok) return validated;
  const data = validated.data;
  return {
    ok: true,
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      trade: data.trade,
      notes: data.notes === "" ? null : data.notes,
    },
  };
}

const CONTRACTOR_EMAIL_TAKEN =
  "Diese E-Mail-Adresse ist bereits einem anderen Handwerker zugeordnet. Bitte eine andere E-Mail-Adresse verwenden oder den bestehenden Handwerker bearbeiten.";

export async function createContractor(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = contractorValues(formData);
  if (!validated.ok) return fail(validated.error);
  const result = runWrite(() => getDb().insert(contractors).values(validated.data).run(), {
    emailTaken: CONTRACTOR_EMAIL_TAKEN,
  });
  if (result.error) return result;
  revalidatePath("/stammdaten/handwerker");
  return OK;
}

export async function updateContractor(id: number, formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const validated = contractorValues(formData);
  if (!validated.ok) return fail(validated.error);
  const result = runWrite(
    () =>
      getDb()
        .update(contractors)
        .set(validated.data)
        .where(eq(contractors.id, id))
        .run(),
    { emailTaken: CONTRACTOR_EMAIL_TAKEN },
  );
  if (result.error) return result;
  revalidatePath("/stammdaten/handwerker");
  return OK;
}

export async function deleteContractor(id: number): Promise<ActionResult> {
  await requireAuth();
  const result = runDelete(
    () => getDb().delete(contractors).where(eq(contractors.id, id)).run(),
    "Handwerker kann nicht gelöscht werden: Es existieren noch Vorgänge oder Genehmigungen zu diesem Handwerker.",
  );
  if (result.error) return result;
  revalidatePath("/stammdaten/handwerker");
  return OK;
}
