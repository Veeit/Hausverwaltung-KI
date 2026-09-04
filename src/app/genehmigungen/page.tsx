import { redirect } from "next/navigation";

/**
 * Genehmigungen und Rückfragen liegen seit dem Neubau der Oberfläche
 * gemeinsam unter /zu-erledigen. Dieser Pfad bleibt als Weiterleitung
 * bestehen, damit Lesezeichen und ältere Links weiter funktionieren.
 */
export default function GenehmigungenPage() {
  redirect("/zu-erledigen");
}
