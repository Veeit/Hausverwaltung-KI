import Link from "next/link";
import { createTenant, deleteTenant, updateTenant } from "@/app/actions/masterdata";
import { getDb } from "@/db/client";
import { properties, tenants } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function MieterPage() {
  const db = getDb();
  const allProperties = db.select().from(properties).all();
  const allTenants = db.select().from(tenants).all();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-2">Stammdaten: Mieter</h1>
      <nav className="mb-2 flex gap-4 text-sm">
        <Link href="/stammdaten/mieter" className="underline font-semibold">Mieter</Link>
        <Link href="/stammdaten/objekte" className="underline">Objekte</Link>
        <Link href="/stammdaten/handwerker" className="underline">Handwerker</Link>
      </nav>
      <p className="text-sm text-gray-600 mb-6">
        Die KI ordnet eingehende Mails über die E-Mail-Adresse dem Mieter zu. Löschen
        schlägt mit einer Fehlermeldung fehl, solange Vorgänge zum Mieter existieren.
      </p>

      <table className="w-full border-collapse mb-8 text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">E-Mail</th>
            <th className="py-2 pr-4">Objekt</th>
            <th className="py-2 pr-4">Wohnung</th>
            <th className="py-2 pr-4">Telefon</th>
            <th className="py-2">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {allTenants.map((t) => (
            <tr key={t.id} className="border-b align-top">
              <td className="py-2 pr-4">
                <input
                  name="name"
                  defaultValue={t.name}
                  required
                  form={`tenant-${t.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  name="email"
                  type="email"
                  defaultValue={t.email}
                  required
                  form={`tenant-${t.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <select
                  name="propertyId"
                  defaultValue={t.propertyId}
                  form={`tenant-${t.id}`}
                  className="border rounded px-2 py-1 w-full"
                >
                  {allProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-4">
                <input
                  name="unitLabel"
                  defaultValue={t.unitLabel ?? ""}
                  form={`tenant-${t.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  name="phone"
                  defaultValue={t.phone ?? ""}
                  form={`tenant-${t.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 whitespace-nowrap">
                <form
                  action={updateTenant.bind(null, t.id)}
                  id={`tenant-${t.id}`}
                  className="inline-block mr-2"
                >
                  <button type="submit" className="border rounded px-2 py-1">
                    Speichern
                  </button>
                </form>
                <form action={deleteTenant.bind(null, t.id)} className="inline-block">
                  <button type="submit" className="border rounded px-2 py-1 text-red-700">
                    Löschen
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {allTenants.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-gray-500">
                Noch keine Mieter angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-2">Neuen Mieter anlegen</h2>
      {allProperties.length === 0 ? (
        <p className="text-gray-600">
          Bitte zuerst unter{" "}
          <Link href="/stammdaten/objekte" className="underline">
            Objekte
          </Link>{" "}
          ein Objekt anlegen.
        </p>
      ) : (
        <form action={createTenant} className="grid gap-2 max-w-md">
          <input
            name="name"
            placeholder="Name"
            required
            className="border rounded px-2 py-1"
          />
          <input
            name="email"
            type="email"
            placeholder="E-Mail"
            required
            className="border rounded px-2 py-1"
          />
          <select name="propertyId" required className="border rounded px-2 py-1">
            {allProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
          <input
            name="unitLabel"
            placeholder="Wohnung (z.B. 2. OG links)"
            className="border rounded px-2 py-1"
          />
          <input
            name="phone"
            placeholder="Telefon (optional)"
            className="border rounded px-2 py-1"
          />
          <button type="submit" className="border rounded px-2 py-1 font-semibold">
            Anlegen
          </button>
        </form>
      )}
    </main>
  );
}
