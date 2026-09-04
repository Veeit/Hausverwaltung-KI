import { redirect } from "next/navigation";

/** Siehe /genehmigungen: beides liegt jetzt unter /zu-erledigen. */
export default function EskalationenPage() {
  redirect("/zu-erledigen");
}
