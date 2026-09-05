import { listWaitlist, deleteWaitlistEntry } from "@/app/actions/waitlist";
import { ActionForm } from "@/app/components/ActionForm";
import { formatDate } from "@/lib/format";
import { unitBucketLabel } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const eintraege = await listWaitlist();
  const mitDemo = eintraege.filter((e) => e.wantsDemo === 1);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Warteliste</h1>
        <p className="mt-1 text-sm text-gray-600">
          Eintragungen über die öffentliche Produktseite. {eintraege.length}{" "}
          {eintraege.length === 1 ? "Eintrag" : "Einträge"}, davon{" "}
          {mitDemo.length} mit Demo-Wunsch.
        </p>
      </div>

      {eintraege.length === 0 ? (
        <p className="text-sm text-gray-500">
          Noch niemand eingetragen. Die Seite nimmt Eintragungen unter{" "}
          <span className="font-mono">/#warteliste</span> entgegen.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-2 pr-3 font-medium">E-Mail</th>
                <th className="py-2 pr-3 font-medium">Größe</th>
                <th className="py-2 pr-3 font-medium">Demo</th>
                <th className="py-2 pr-3 font-medium">Eingetragen</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {eintraege.map((e) => (
                <tr key={e.id} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-3">
                    <a href={`mailto:${e.email}`} className="text-blue-600 underline">
                      {e.email}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-gray-700">{unitBucketLabel(e.units)}</td>
                  <td className="py-2 pr-3">
                    {e.wantsDemo === 1 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        angefragt
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{formatDate(e.createdAt)}</td>
                  <td className="py-2">
                    <ActionForm action={deleteWaitlistEntry.bind(null, e.id)}>
                      <button
                        type="submit"
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Löschen
                      </button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-gray-200 pt-4 text-xs text-gray-500">
        Gespeichert werden ausschließlich E-Mail-Adresse, Größenangabe und der
        Demo-Wunsch. Verlangt jemand die Streichung, genügt hier „Löschen“ —
        der Eintrag wird sofort und vollständig entfernt.
      </p>
    </main>
  );
}
