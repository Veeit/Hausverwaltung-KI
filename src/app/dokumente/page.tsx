import { removeDocument, uploadDocument } from "@/app/actions/documents";
import { listDocuments } from "@/lib/documents";
import { ActionForm } from "@/app/components/ActionForm";

export const dynamic = "force-dynamic";

export default function DokumentePage() {
  const docs = listDocuments();

  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Dokumente</h1>
      <p className="text-sm text-gray-600 mb-6">
        Wissensquelle der KI: Hochgeladene Dokumente (PDF, TXT, MD) werden als Text
        extrahiert und stehen dem KI-Assistenten über die Volltextsuche zur Verfügung.
      </p>

      <table className="w-full border-collapse mb-8 text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Dateiname</th>
            <th className="py-2 pr-4">Typ</th>
            <th className="py-2 pr-4">Größe (extrahierter Text)</th>
            <th className="py-2 pr-4">Hochgeladen</th>
            <th className="py-2">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id} className="border-b align-top">
              <td className="py-2 pr-4">{doc.filename}</td>
              <td className="py-2 pr-4">{doc.mimeType}</td>
              <td className="py-2 pr-4">
                {doc.contentLength.toLocaleString("de-DE")} Zeichen
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                {new Date(doc.createdAt).toLocaleDateString("de-DE")}
              </td>
              <td className="py-2">
                <ActionForm action={removeDocument.bind(null, doc.id)}>
                  <button type="submit" className="border rounded px-2 py-1 text-red-700">
                    Löschen
                  </button>
                </ActionForm>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-500">
                Noch keine Dokumente hochgeladen.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-2">Dokument hochladen</h2>
      <ActionForm action={uploadDocument} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="border rounded px-2 py-1"
        />
        <button type="submit" className="border rounded px-2 py-1 font-semibold">
          Hochladen
        </button>
      </ActionForm>
    </main>
  );
}
