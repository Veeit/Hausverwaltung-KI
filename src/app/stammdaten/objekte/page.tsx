import Link from "next/link";
import { createProperty, deleteProperty, updateProperty } from "@/app/actions/masterdata";
import { getDb } from "@/db/client";
import { properties } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function ObjektePage() {
  const allProperties = getDb().select().from(properties).all();

  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Stammdaten: Objekte</h1>
      <nav className="mb-2 flex gap-4 text-sm">
        <Link href="/stammdaten/mieter" className="underline">Mieter</Link>
        <Link href="/stammdaten/objekte" className="underline font-semibold">Objekte</Link>
        <Link href="/stammdaten/handwerker" className="underline">Handwerker</Link>
      </nav>
      <p className="text-sm text-gray-600 mb-6">
        Löschen schlägt mit einer Fehlermeldung fehl, solange dem Objekt noch Mieter
        zugeordnet sind.
      </p>

      <table className="w-full border-collapse mb-8 text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Adresse</th>
            <th className="py-2 pr-4">Angelegt</th>
            <th className="py-2">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {allProperties.map((p) => (
            <tr key={p.id} className="border-b align-top">
              <td className="py-2 pr-4">
                <form action={updateProperty.bind(null, p.id)} className="flex gap-2">
                  <input
                    name="address"
                    defaultValue={p.address}
                    required
                    className="border rounded px-2 py-1 w-full"
                  />
                  <button type="submit" className="border rounded px-2 py-1">
                    Speichern
                  </button>
                </form>
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {new Date(p.createdAt).toLocaleDateString("de-DE")}
              </td>
              <td className="py-2">
                <form action={deleteProperty.bind(null, p.id)}>
                  <button type="submit" className="border rounded px-2 py-1 text-red-700">
                    Löschen
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {allProperties.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-gray-500">
                Noch keine Objekte angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-2">Neues Objekt anlegen</h2>
      <form action={createProperty} className="flex gap-2 max-w-md">
        <input
          name="address"
          placeholder="Straße Hausnr., PLZ Ort"
          required
          className="border rounded px-2 py-1 w-full"
        />
        <button type="submit" className="border rounded px-2 py-1 font-semibold">
          Anlegen
        </button>
      </form>
    </main>
  );
}
