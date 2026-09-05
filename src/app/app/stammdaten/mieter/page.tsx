import { redirect } from "next/navigation";

/** Mieter, Handwerker und Objekte stehen jetzt gemeinsam unter /stammdaten. */
export default function MieterRedirectPage() {
  redirect("/stammdaten");
}
