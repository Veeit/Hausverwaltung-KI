import Link from "next/link";
import {
  createContractor,
  deleteContractor,
  updateContractor,
} from "@/app/actions/masterdata";
import { getDb } from "@/db/client";
import { contractors } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function HandwerkerPage() {
  const allContractors = getDb().select().from(contractors).all();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-2">Stammdaten: Handwerker</h1>
      <nav className="mb-2 flex gap-4 text-sm">
        <Link href="/stammdaten/mieter" className="underline">Mieter</Link>
        <Link href="/stammdaten/objekte" className="underline">Objekte</Link>
        <Link href="/stammdaten/handwerker" className="underline font-semibold">Handwerker</Link>
      </nav>
      <p className="text-sm text-gray-600 mb-6">
        Die KI schlägt Handwerker anhand des Gewerks vor (z.B. Sanitär, Elektrik,
        Schlüsseldienst). Kontaktiert wird ein Handwerker erst nach Genehmigung im
        Dashboard.
      </p>

      <table className="w-full border-collapse mb-8 text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">E-Mail</th>
            <th className="py-2 pr-4">Gewerk</th>
            <th className="py-2 pr-4">Notizen</th>
            <th className="py-2">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {allContractors.map((c) => (
            <tr key={c.id} className="border-b align-top">
              <td className="py-2 pr-4">
                <input
                  name="name"
                  defaultValue={c.name}
                  required
                  form={`contractor-${c.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  name="email"
                  type="email"
                  defaultValue={c.email}
                  required
                  form={`contractor-${c.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  name="trade"
                  defaultValue={c.trade}
                  required
                  form={`contractor-${c.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 pr-4">
                <input
                  name="notes"
                  defaultValue={c.notes ?? ""}
                  form={`contractor-${c.id}`}
                  className="border rounded px-2 py-1 w-full"
                />
              </td>
              <td className="py-2 whitespace-nowrap">
                <form
                  action={updateContractor.bind(null, c.id)}
                  id={`contractor-${c.id}`}
                  className="inline-block mr-2"
                >
                  <button type="submit" className="border rounded px-2 py-1">
                    Speichern
                  </button>
                </form>
                <form action={deleteContractor.bind(null, c.id)} className="inline-block">
                  <button type="submit" className="border rounded px-2 py-1 text-red-700">
                    Löschen
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {allContractors.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-500">
                Noch keine Handwerker angelegt.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-2">Neuen Handwerker anlegen</h2>
      <form action={createContractor} className="grid gap-2 max-w-md">
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
        <input
          name="trade"
          placeholder="Gewerk (z.B. Sanitär, Elektrik, Schlüsseldienst)"
          required
          className="border rounded px-2 py-1"
        />
        <input
          name="notes"
          placeholder="Notizen (optional)"
          className="border rounded px-2 py-1"
        />
        <button type="submit" className="border rounded px-2 py-1 font-semibold">
          Anlegen
        </button>
      </form>
    </main>
  );
}
