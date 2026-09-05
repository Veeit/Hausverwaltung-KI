import { removeDocument, uploadDocument } from "@/app/actions/documents";
import { listDocuments } from "@/lib/documents";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
};

export default function DokumentePage() {
  const docs = listDocuments();

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Dokumente</h1>
          <p className="meta">Woraus der Assistent antwortet, ohne Sie zu fragen</p>
        </div>
      </header>

      <main className="main main-narrow">
        <p className="lead">
          Laden Sie hoch, was Mieter typischerweise fragen — Hausordnung, Ruhezeiten,
          wer bei einem Notfall am Wochenende anzurufen ist. Steht die Antwort hier,
          gibt der Assistent sie selbst, und Sie bekommen die Frage gar nicht erst zu
          sehen.
        </p>

        <section className="card">
          <div className="card-h">
            <h2>Ihre Dokumente</h2>
            <span className="meta push">
              {docs.length} {docs.length === 1 ? "Datei" : "Dateien"}
            </span>
          </div>

          {docs.length === 0 ? (
            <div className="card-b">
              <p className="meta">
                Noch nichts hochgeladen. Der Assistent fragt dann bei allem nach, was
                nicht im Schriftwechsel steht.
              </p>
            </div>
          ) : (
            <ul className="rows">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <span className="msg-av av-unknown">
                    <Icon name="dokumente" className="icon icon-sm" />
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>{doc.filename}</p>
                    <p className="meta">
                      {TYPE_LABELS[doc.mimeType] ?? doc.mimeType} ·{" "}
                      {doc.contentLength.toLocaleString("de-DE")} Zeichen ausgelesen ·
                      hochgeladen am {new Date(doc.createdAt).toLocaleDateString("de-DE")}
                    </p>
                  </div>
                  <ActionForm action={removeDocument.bind(null, doc.id)}>
                    <button type="submit" className="btn btn-danger btn-sm">
                      <Icon name="loeschen" className="icon icon-sm" />
                      Löschen
                    </button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" style={{ borderStyle: "dashed", borderColor: "var(--line-2)" }}>
          <div className="card-b" style={{ alignItems: "center", textAlign: "center", gap: 10, padding: "28px 20px" }}>
            <span className="msg-av av-lg" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
              <Icon name="upload" />
            </span>
            <p style={{ fontWeight: 700, fontSize: 15 }}>Datei hochladen</p>
            <p className="meta">PDF, TXT oder Markdown</p>
            <ActionForm action={uploadDocument} className="row-wrap actions-stack" >
              <input
                className="field"
                style={{ paddingTop: 10 }}
                type="file"
                name="file"
                required
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                aria-label="Datei auswählen"
              />
              <button type="submit" className="btn btn-primary">
                Hochladen
              </button>
            </ActionForm>
          </div>
        </section>
      </main>
    </>
  );
}
