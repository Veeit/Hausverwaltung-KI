import { listWaitlist, deleteWaitlistEntry } from "@/app/actions/waitlist";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";
import { formatDate } from "@/lib/format";
import { unitBucketLabel } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export default async function WartelistePage() {
  const eintraege = await listWaitlist();
  const mitDemo = eintraege.filter((e) => e.wantsDemo === 1);

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Warteliste</h1>
          <p className="meta">Wer sich auf der Produktseite eingetragen hat</p>
        </div>
      </header>

      <main className="main main-narrow">
        <p className="lead">
          Das Produkt ist noch nicht buchbar. Wer auf der öffentlichen Seite
          Interesse zeigt, landet hier — mit Größenangabe, damit Sie
          einschätzen können, wen Sie zuerst anrufen. Die Demo-Wünsche stehen
          oben.
        </p>

        <section className="card">
          <div className="card-h">
            <h2>Eintragungen</h2>
            <span className="meta push">
              {eintraege.length} {eintraege.length === 1 ? "Eintrag" : "Einträge"}
              {mitDemo.length > 0 ? ` · ${mitDemo.length} mit Demo-Wunsch` : ""}
            </span>
          </div>

          {eintraege.length === 0 ? (
            <div className="card-b">
              <p className="meta">
                Noch niemand eingetragen. Das Formular steht am Fuß der
                Produktseite.
              </p>
            </div>
          ) : (
            <ul className="rows">
              {eintraege.map((e) => (
                <li key={e.id}>
                  <span className={`msg-av ${e.wantsDemo === 1 ? "av-landlord" : "av-unknown"}`}>
                    <Icon name="stammdaten" className="icon icon-sm" />
                  </span>
                  <div className="grow">
                    <p style={{ fontWeight: 700 }}>
                      <a href={`mailto:${e.email}`}>{e.email}</a>
                    </p>
                    <p className="meta">
                      {unitBucketLabel(e.units)} · eingetragen am {formatDate(e.createdAt)}
                    </p>
                  </div>
                  {e.wantsDemo === 1 ? <span className="tag">Demo gewünscht</span> : null}
                  <ActionForm action={deleteWaitlistEntry.bind(null, e.id)}>
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

        <p className="meta">
          Gespeichert werden ausschließlich E-Mail-Adresse, Größenangabe und
          der Demo-Wunsch. Verlangt jemand die Streichung, genügt hier
          &bdquo;Löschen&ldquo; — der Eintrag wird sofort und vollständig
          entfernt.
        </p>
      </main>
    </>
  );
}
