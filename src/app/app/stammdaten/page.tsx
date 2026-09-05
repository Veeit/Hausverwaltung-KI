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
 * das eine Seite, die man einmal im Jahr aufmacht, und kein eigener Bereich.
 * Die alten Pfade leiten hierher.
 *
 * Bearbeitet wird direkt in der Zeile: Die Felder tragen `form="…"` und
 * gehören damit zum Speichern-Formular derselben Zeile, ohne dass Formulare
 * ineinander verschachtelt werden müssten (das erlaubt HTML nicht).
 */
export default function StammdatenPage() {
  const db = getDb();
  const allProperties = db.select().from(properties).all();
  const allTenants = db.select().from(tenants).all();
  const allContractors = db.select().from(contractors).all();

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
            <ul className="rows">
              {allTenants.map((t) => (
                <li key={t.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <span className="msg-av av-tenant">{t.name.slice(0, 1).toUpperCase()}</span>
                  <div className="grow stack-sm">
                    <div className="form-row">
                      <input
                        className="field field-sm"
                        name="name"
                        defaultValue={t.name}
                        required
                        form={`tenant-${t.id}`}
                        aria-label="Name"
                      />
                      <input
                        className="field field-sm"
                        name="email"
                        type="email"
                        defaultValue={t.email}
                        required
                        form={`tenant-${t.id}`}
                        aria-label="E-Mail"
                      />
                    </div>
                    <div className="form-row">
                      <select
                        className="field field-sm"
                        name="propertyId"
                        defaultValue={t.propertyId}
                        form={`tenant-${t.id}`}
                        aria-label="Objekt"
                      >
                        {allProperties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.address}
                          </option>
                        ))}
                      </select>
                      <input
                        className="field field-sm"
                        name="unitLabel"
                        defaultValue={t.unitLabel ?? ""}
                        placeholder="Wohnung"
                        form={`tenant-${t.id}`}
                        aria-label="Wohnung"
                      />
                      <input
                        className="field field-sm"
                        name="phone"
                        defaultValue={t.phone ?? ""}
                        placeholder="Telefon"
                        form={`tenant-${t.id}`}
                        aria-label="Telefon"
                      />
                    </div>
                    <div className="row-wrap">
                      <ActionForm action={updateTenant.bind(null, t.id)} id={`tenant-${t.id}`}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Speichern
                        </button>
                      </ActionForm>
                      <ActionForm action={deleteTenant.bind(null, t.id)}>
                        <button type="submit" className="btn btn-danger btn-sm">
                          <Icon name="loeschen" className="icon icon-sm" />
                          Löschen
                        </button>
                      </ActionForm>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="card-f" style={{ display: "block" }}>
            <h3 style={{ marginBottom: 12 }}>Neuen Mieter anlegen</h3>
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
                  <Icon name="plus" className="icon icon-sm" />
                  Mieter anlegen
                </button>
              </ActionForm>
            )}
          </div>
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
            <ul className="rows">
              {allContractors.map((c) => (
                <li key={c.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <span className="msg-av av-contractor">
                    <Icon name="werkzeug" className="icon icon-sm" />
                  </span>
                  <div className="grow stack-sm">
                    <div className="form-row">
                      <input
                        className="field field-sm"
                        name="name"
                        defaultValue={c.name}
                        required
                        form={`contractor-${c.id}`}
                        aria-label="Name"
                      />
                      <input
                        className="field field-sm"
                        name="email"
                        type="email"
                        defaultValue={c.email}
                        required
                        form={`contractor-${c.id}`}
                        aria-label="E-Mail"
                      />
                    </div>
                    <div className="form-row">
                      <input
                        className="field field-sm"
                        name="trade"
                        defaultValue={c.trade}
                        required
                        placeholder="Gewerk"
                        form={`contractor-${c.id}`}
                        aria-label="Gewerk"
                      />
                      <input
                        className="field field-sm"
                        name="notes"
                        defaultValue={c.notes ?? ""}
                        placeholder="Notizen"
                        form={`contractor-${c.id}`}
                        aria-label="Notizen"
                      />
                    </div>
                    <div className="row-wrap">
                      <ActionForm
                        action={updateContractor.bind(null, c.id)}
                        id={`contractor-${c.id}`}
                      >
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Speichern
                        </button>
                      </ActionForm>
                      <ActionForm action={deleteContractor.bind(null, c.id)}>
                        <button type="submit" className="btn btn-danger btn-sm">
                          <Icon name="loeschen" className="icon icon-sm" />
                          Löschen
                        </button>
                      </ActionForm>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="card-f" style={{ display: "block" }}>
            <h3 style={{ marginBottom: 12 }}>Neuen Handwerker anlegen</h3>
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
                <Icon name="plus" className="icon icon-sm" />
                Handwerker anlegen
              </button>
            </ActionForm>
          </div>
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
            <ul className="rows">
              {allProperties.map((p) => (
                <li key={p.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                  <span className="msg-av av-unknown">
                    <Icon name="gebaeude" className="icon icon-sm" />
                  </span>
                  <div className="grow stack-sm">
                    <input
                      className="field field-sm"
                      name="address"
                      defaultValue={p.address}
                      required
                      form={`property-${p.id}`}
                      aria-label="Adresse"
                    />
                    <div className="row-wrap">
                      <ActionForm action={updateProperty.bind(null, p.id)} id={`property-${p.id}`}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Speichern
                        </button>
                      </ActionForm>
                      <ActionForm action={deleteProperty.bind(null, p.id)}>
                        <button type="submit" className="btn btn-danger btn-sm">
                          <Icon name="loeschen" className="icon icon-sm" />
                          Löschen
                        </button>
                      </ActionForm>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="card-f" style={{ display: "block" }}>
            <h3 style={{ marginBottom: 12 }}>Neues Objekt anlegen</h3>
            <ActionForm action={createProperty} className="form-grid">
              <input
                className="field"
                name="address"
                placeholder="Straße Hausnr., PLZ Ort"
                required
                aria-label="Adresse"
              />
              <button type="submit" className="btn btn-primary">
                <Icon name="plus" className="icon icon-sm" />
                Objekt anlegen
              </button>
            </ActionForm>
          </div>
        </section>
      </main>
    </>
  );
}
