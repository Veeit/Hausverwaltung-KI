import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contractors, properties, tenants } from "@/db/schema";
import {
  createContractor,
  createProperty,
  createTenant,
  deleteContractor,
  deleteProperty,
  deleteTenant,
  updateContractor,
  updateProperty,
  updateTenant,
} from "@/app/actions/masterdata";
import { ActionForm } from "@/app/components/ActionForm";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

/**
 * Mieter, Handwerker und Objekte auf einer Seite. Vorher waren es drei
 * Unterseiten mit eigener Navigation — bei einem Haus mit vier Wohnungen ist
 * das eine Seite, die man einmal im Jahr aufmacht. Die alten Pfade leiten
 * hierher.
 *
 * Jeder Eintrag ist eine ruhige Zeile und klappt zum Bearbeiten auf. Die
 * Felder liegen dabei direkt im jeweiligen Speichern-Formular; das Löschen-
 * Formular steht als Geschwister daneben, weil HTML keine verschachtelten
 * Formulare erlaubt.
 */

function Chevron() {
  return (
    <span className="entry-chev">
      <Icon name="weiter" className="icon icon-sm" />
    </span>
  );
}

export default function StammdatenPage() {
  const db = getDb();
  const allProperties = db.select().from(properties).all();
  const allTenants = db.select().from(tenants).all();
  const allContractors = db.select().from(contractors).all();

  const tenantsPerProperty = new Map(
    db
      .select({ propertyId: tenants.propertyId, n: count() })
      .from(tenants)
      .groupBy(tenants.propertyId)
      .all()
      .map((r) => [r.propertyId, r.n]),
  );

  return (
    <>
      <header className="top">
        <div className="top-text">
          <h1>Mieter &amp; Handwerker</h1>
          <p className="meta">
            Einmal eingetragen — danach müssen Sie hier praktisch nie wieder hin
          </p>
        </div>
      </header>

      <main className="main main-narrow">
        <div className="note note-c">
          <Icon name="schloss" />
          <p className="muted">
            Der Assistent schreibt ausschließlich an Adressen aus diesen Listen.
            Meldet sich jemand Unbekanntes, bleibt die Mail liegen und Sie sehen
            einen Hinweis auf der Übersicht.
          </p>
        </div>

        {/* ---------------- Mieter ---------------- */}
        <section className="card">
          <div className="card-h">
            <h2>Mieter</h2>
            <span className="meta push">
              {allTenants.length} {allTenants.length === 1 ? "Eintrag" : "Einträge"}
            </span>
          </div>

          {allTenants.length === 0 ? (
            <div className="card-b">
              <p className="meta">Noch keine Mieter angelegt.</p>
            </div>
          ) : (
            allTenants.map((t) => (
              <details key={t.id} className="entry">
                <summary className="entry-sum">
                  <span className="msg-av av-tenant">{t.name.slice(0, 1).toUpperCase()}</span>
                  <span className="grow">
                    <span className="entry-name">{t.name}</span>
                    <span className="meta" style={{ display: "block" }}>
                      {t.email}
                      {t.unitLabel ? ` · ${t.unitLabel}` : ""}
                      {t.phone ? ` · ${t.phone}` : ""}
                    </span>
                  </span>
                  <Chevron />
                </summary>
                <div className="entry-body">
                  <ActionForm action={updateTenant.bind(null, t.id)} className="stack-sm">
                    <div className="form-row">
                      <div>
                        <label className="label" htmlFor={`t-name-${t.id}`}>
                          Name
                        </label>
                        <input
                          id={`t-name-${t.id}`}
                          className="field field-sm"
                          name="name"
                          defaultValue={t.name}
                          required
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`t-mail-${t.id}`}>
                          E-Mail
                        </label>
                        <input
                          id={`t-mail-${t.id}`}
                          className="field field-sm"
                          name="email"
                          type="email"
                          defaultValue={t.email}
                          required
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div>
                        <label className="label" htmlFor={`t-obj-${t.id}`}>
                          Objekt
                        </label>
                        <select
                          id={`t-obj-${t.id}`}
                          className="field field-sm"
                          name="propertyId"
                          defaultValue={t.propertyId}
                        >
                          {allProperties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.address}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor={`t-unit-${t.id}`}>
                          Wohnung
                        </label>
                        <input
                          id={`t-unit-${t.id}`}
                          className="field field-sm"
                          name="unitLabel"
                          defaultValue={t.unitLabel ?? ""}
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`t-tel-${t.id}`}>
                          Telefon
                        </label>
                        <input
                          id={`t-tel-${t.id}`}
                          className="field field-sm"
                          name="phone"
                          defaultValue={t.phone ?? ""}
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Speichern
                    </button>
                  </ActionForm>

                  <ActionForm action={deleteTenant.bind(null, t.id)}>
                    <button type="submit" className="btn btn-danger btn-sm">
                      <Icon name="loeschen" className="icon icon-sm" />
                      Mieter löschen
                    </button>
                  </ActionForm>
                </div>
              </details>
            ))
          )}

          <details className="entry-add">
            <summary>
              <Icon name="plus" className="icon icon-sm" />
              Mieter hinzufügen
            </summary>
            <div className="entry-add-body">
              {allProperties.length === 0 ? (
                <p className="muted">Bitte zuerst weiter unten ein Objekt anlegen.</p>
              ) : (
                <ActionForm action={createTenant} className="form-grid">
                  <input className="field" name="name" placeholder="Name" required aria-label="Name" />
                  <input
                    className="field"
                    name="email"
                    type="email"
                    placeholder="E-Mail"
                    required
                    aria-label="E-Mail"
                  />
                  <select className="field" name="propertyId" required aria-label="Objekt">
                    {allProperties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.address}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    name="unitLabel"
                    placeholder="Wohnung (z. B. 2. OG links)"
                    aria-label="Wohnung"
                  />
                  <input
                    className="field"
                    name="phone"
                    placeholder="Telefon (optional)"
                    aria-label="Telefon"
                  />
                  <button type="submit" className="btn btn-primary">
                    Mieter anlegen
                  </button>
                </ActionForm>
              )}
            </div>
          </details>
        </section>

        {/* ---------------- Handwerker ---------------- */}
        <section className="card">
          <div className="card-h">
            <h2>Handwerker</h2>
            <span className="meta push">Nur diese darf der Assistent beauftragen</span>
          </div>

          {allContractors.length === 0 ? (
            <div className="card-b">
              <p className="meta">Noch keine Handwerker angelegt.</p>
            </div>
          ) : (
            allContractors.map((c) => (
              <details key={c.id} className="entry">
                <summary className="entry-sum">
                  <span className="msg-av av-contractor">
                    <Icon name="werkzeug" className="icon icon-sm" />
                  </span>
                  <span className="grow">
                    <span className="entry-name">{c.name}</span>
                    <span className="meta" style={{ display: "block" }}>
                      {c.trade} · {c.email}
                    </span>
                  </span>
                  <Chevron />
                </summary>
                <div className="entry-body">
                  <ActionForm action={updateContractor.bind(null, c.id)} className="stack-sm">
                    <div className="form-row">
                      <div>
                        <label className="label" htmlFor={`c-name-${c.id}`}>
                          Name
                        </label>
                        <input
                          id={`c-name-${c.id}`}
                          className="field field-sm"
                          name="name"
                          defaultValue={c.name}
                          required
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`c-mail-${c.id}`}>
                          E-Mail
                        </label>
                        <input
                          id={`c-mail-${c.id}`}
                          className="field field-sm"
                          name="email"
                          type="email"
                          defaultValue={c.email}
                          required
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div>
                        <label className="label" htmlFor={`c-trade-${c.id}`}>
                          Gewerk
                        </label>
                        <input
                          id={`c-trade-${c.id}`}
                          className="field field-sm"
                          name="trade"
                          defaultValue={c.trade}
                          required
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor={`c-notes-${c.id}`}>
                          Notizen
                        </label>
                        <input
                          id={`c-notes-${c.id}`}
                          className="field field-sm"
                          name="notes"
                          defaultValue={c.notes ?? ""}
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Speichern
                    </button>
                  </ActionForm>

                  <ActionForm action={deleteContractor.bind(null, c.id)}>
                    <button type="submit" className="btn btn-danger btn-sm">
                      <Icon name="loeschen" className="icon icon-sm" />
                      Handwerker löschen
                    </button>
                  </ActionForm>
                </div>
              </details>
            ))
          )}

          <details className="entry-add">
            <summary>
              <Icon name="plus" className="icon icon-sm" />
              Handwerker hinzufügen
            </summary>
            <div className="entry-add-body">
              <ActionForm action={createContractor} className="form-grid">
                <input className="field" name="name" placeholder="Name" required aria-label="Name" />
                <input
                  className="field"
                  name="email"
                  type="email"
                  placeholder="E-Mail"
                  required
                  aria-label="E-Mail"
                />
                <input
                  className="field"
                  name="trade"
                  placeholder="Gewerk (z. B. Sanitär, Elektrik, Schlüsseldienst)"
                  required
                  aria-label="Gewerk"
                />
                <input
                  className="field"
                  name="notes"
                  placeholder="Notizen (optional)"
                  aria-label="Notizen"
                />
                <button type="submit" className="btn btn-primary">
                  Handwerker anlegen
                </button>
              </ActionForm>
            </div>
          </details>
        </section>

        {/* ---------------- Objekte ---------------- */}
        <section className="card">
          <div className="card-h">
            <h2>Objekte</h2>
            <span className="meta push">
              Löschen geht erst, wenn dem Objekt kein Mieter mehr zugeordnet ist
            </span>
          </div>

          {allProperties.length === 0 ? (
            <div className="card-b">
              <p className="meta">Noch keine Objekte angelegt.</p>
            </div>
          ) : (
            allProperties.map((p) => {
              const n = tenantsPerProperty.get(p.id) ?? 0;
              return (
                <details key={p.id} className="entry">
                  <summary className="entry-sum">
                    <span className="msg-av av-unknown">
                      <Icon name="gebaeude" className="icon icon-sm" />
                    </span>
                    <span className="grow">
                      <span className="entry-name">{p.address}</span>
                      <span className="meta" style={{ display: "block" }}>
                        {n === 0 ? "Kein Mieter" : `${n} Mieter`} zugeordnet
                      </span>
                    </span>
                    <Chevron />
                  </summary>
                  <div className="entry-body">
                    <ActionForm action={updateProperty.bind(null, p.id)} className="stack-sm">
                      <div>
                        <label className="label" htmlFor={`p-adr-${p.id}`}>
                          Adresse
                        </label>
                        <input
                          id={`p-adr-${p.id}`}
                          className="field field-sm"
                          name="address"
                          defaultValue={p.address}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-ghost btn-sm">
                        Speichern
                      </button>
                    </ActionForm>

                    <ActionForm action={deleteProperty.bind(null, p.id)}>
                      <button type="submit" className="btn btn-danger btn-sm">
                        <Icon name="loeschen" className="icon icon-sm" />
                        Objekt löschen
                      </button>
                    </ActionForm>
                  </div>
                </details>
              );
            })
          )}

          <details className="entry-add">
            <summary>
              <Icon name="plus" className="icon icon-sm" />
              Objekt hinzufügen
            </summary>
            <div className="entry-add-body">
              <ActionForm action={createProperty} className="form-grid">
                <input
                  className="field"
                  name="address"
                  placeholder="Straße Hausnr., PLZ Ort"
                  required
                  aria-label="Adresse"
                />
                <button type="submit" className="btn btn-primary">
                  Objekt anlegen
                </button>
              </ActionForm>
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
