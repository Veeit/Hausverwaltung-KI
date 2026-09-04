"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { Icon, type IconName } from "@/app/components/Icon";

/**
 * Rahmen um jede Seite: dunkle Seitenleiste am Desktop, obere Leiste plus
 * untere Tab-Leiste am Telefon (siehe globals.css, Umbruch bei 1024px).
 *
 * Client-Komponente, weil der aktive Eintrag aus dem Pfad kommt. Die Seiten
 * selbst bleiben Server-Komponenten und werden hier nur als `children`
 * durchgereicht — es wandert also kein Seiteninhalt ins Client-Bundle.
 *
 * Genehmigungen und Rückfragen liegen zusammen unter "Zu erledigen": für
 * einen privaten Vermieter ist beides dasselbe — der Assistent braucht ihn.
 */

interface NavEntry {
  href: string;
  icon: IconName;
  label: string;
  /** Weitere Pfad-Präfixe, die diesen Eintrag aktiv setzen. */
  also?: string[];
}

const NAV: NavEntry[] = [
  { href: "/", icon: "uebersicht", label: "Übersicht" },
  {
    href: "/zu-erledigen",
    icon: "erledigen",
    label: "Zu erledigen",
    also: ["/genehmigungen", "/eskalationen"],
  },
  { href: "/vorgaenge", icon: "vorgaenge", label: "Vorgänge" },
  { href: "/stammdaten", icon: "stammdaten", label: "Mieter & Handwerker" },
  { href: "/dokumente", icon: "dokumente", label: "Dokumente" },
];

/** Die Tab-Leiste fasst Stammdaten und Dokumente zu einem "Mehr" zusammen. */
const TABS = NAV.slice(0, 3).concat({
  href: "/stammdaten",
  icon: "stammdaten",
  label: "Mehr",
  also: ["/dokumente"],
});

function isActive(pathname: string, entry: NavEntry): boolean {
  const matches = (base: string) =>
    base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(`${base}/`);
  return matches(entry.href) || (entry.also ?? []).some(matches);
}

export function AppShell({
  children,
  openTasks,
  objectName,
  objectSub,
  lastPollLabel,
}: {
  children: React.ReactNode;
  openTasks: number;
  objectName: string;
  objectSub: string;
  lastPollLabel: string;
}) {
  const pathname = usePathname();

  // Die Anmeldeseite trägt ihr eigenes Layout und darf keine Navigation zu
  // Seiten zeigen, die ohne Anmeldung ohnehin nicht erreichbar sind.
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="haus" />
          </span>
          <div className="grow">
            <div className="brand-name">{objectName}</div>
            <div className="brand-sub">{objectSub}</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className={`nav-item${isActive(pathname, entry) ? " active" : ""}`}
              aria-current={isActive(pathname, entry) ? "page" : undefined}
            >
              <Icon name={entry.icon} />
              <span className="nav-label">{entry.label}</span>
              {entry.href === "/zu-erledigen" && openTasks > 0 ? (
                <span className="count">{openTasks}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="side-foot">
          <div className="side-note">
            <div className="row" style={{ gap: 9 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#3fa46a",
                  flex: "none",
                }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#fff" }}>
                Assistent hört mit
              </span>
            </div>
            <p>{lastPollLabel}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="nav-item">
              <Icon name="abmelden" />
              <span className="nav-label">Abmelden</span>
            </button>
          </form>
        </div>
      </aside>

      <div className="shell-col">
        <header className="m-top">
          <span className="brand-mark">
            <Icon name="haus" />
          </span>
          <div className="grow">
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.015em" }}>
              {objectName}
            </div>
            <div className="meta">{objectSub}</div>
          </div>
          <form action={logout}>
            <button type="submit" className="m-btn" aria-label="Abmelden">
              <Icon name="abmelden" />
            </button>
          </form>
        </header>

        {children}

        <nav className="tabbar">
          {TABS.map((entry) => (
            <Link
              key={entry.label}
              href={entry.href}
              className={`tab${isActive(pathname, entry) ? " active" : ""}`}
              aria-current={isActive(pathname, entry) ? "page" : undefined}
            >
              {entry.href === "/zu-erledigen" && openTasks > 0 ? (
                <span className="tab-dot">{openTasks}</span>
              ) : null}
              <Icon name={entry.icon} />
              <span>{entry.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default AppShell;
