import { login } from "@/app/actions/auth";
import { Icon } from "@/app/components/Icon";
import { Steps } from "@/app/components/Steps";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="login">
      <div className="login-form">
        <div>
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark" style={{ width: 44, height: 44 }}>
              <Icon name="haus" className="icon icon-lg" />
            </span>
            <div>
              <div className="brand-name" style={{ color: "var(--ink)", fontSize: 17 }}>
                Hausverwaltung
              </div>
              <div className="meta">Vermieter-Zugang</div>
            </div>
          </div>

          <div className="stack-xs">
            <h1>Willkommen zurück</h1>
            <p className="muted">
              Melden Sie sich an, um zu sehen, was Ihre Mieter gemeldet haben.
            </p>
          </div>

          {params.fehler === "konfiguration" ? (
            <div className="note note-warn">
              <Icon name="warnung" />
              <p>
                Die Anmeldung ist nicht eingerichtet: Es ist kein DASHBOARD_PASSWORD
                hinterlegt. Bitte wenden Sie sich an den Betreiber.
              </p>
            </div>
          ) : params.fehler ? (
            <div className="note note-warn">
              <Icon name="warnung" />
              <p>Falsches Passwort. Bitte versuchen Sie es erneut.</p>
            </div>
          ) : null}

          <form action={login} className="stack-sm">
            <div>
              <label className="label" htmlFor="password">
                Passwort
              </label>
              <input
                id="password"
                className="field"
                name="password"
                type="password"
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block">
              Anmelden
            </button>
          </form>

          <p className="meta">
            Ein Passwort für die Verwaltung. Es steht in der Konfiguration Ihres
            Servers.
          </p>
        </div>
      </div>

      <aside className="login-aside">
        <div className="login-steps">
          <p className="eyebrow">So läuft eine Anfrage</p>
          <Steps />
          <p className="meta" style={{ borderTop: "1px solid #2c2c2c", paddingTop: 16 }}>
            Die meiste Zeit passiert hier nichts — und genau so ist es gedacht.
          </p>
        </div>
      </aside>
    </div>
  );
}
