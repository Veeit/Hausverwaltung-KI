import Link from "next/link";
import { logout } from "@/app/actions/auth";

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1 inline-block rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
      {count}
    </span>
  );
}

export function Nav({
  openApprovals,
  openEscalations,
}: {
  openApprovals: number;
  openEscalations: number;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 text-sm">
      <span className="font-semibold">KI-Hausverwaltung</span>
      <Link href="/" className="hover:underline">
        Übersicht
      </Link>
      <Link href="/vorgaenge" className="hover:underline">
        Vorgänge
      </Link>
      <Link href="/genehmigungen" className="hover:underline">
        Genehmigungen
        <CountBadge count={openApprovals} />
      </Link>
      <Link href="/eskalationen" className="hover:underline">
        Eskalationen
        <CountBadge count={openEscalations} />
      </Link>
      <Link href="/stammdaten/mieter" className="hover:underline">
        Stammdaten
      </Link>
      <Link href="/dokumente" className="hover:underline">
        Dokumente
      </Link>
      <form action={logout} className="ml-auto">
        <button type="submit" className="text-gray-500 hover:underline">
          Abmelden
        </button>
      </form>
    </nav>
  );
}

export default Nav;
