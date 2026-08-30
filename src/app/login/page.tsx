import { login } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm rounded border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold">Anmeldung Hausverwaltung</h1>
      {params.fehler === "konfiguration" ? (
        <p className="mb-4 rounded bg-red-100 p-2 text-sm text-red-800">
          Die Anmeldung ist nicht korrekt konfiguriert: Es ist kein
          DASHBOARD_PASSWORD hinterlegt. Bitte wenden Sie sich an den Betreiber
          und setzen Sie die Umgebungsvariable DASHBOARD_PASSWORD.
        </p>
      ) : params.fehler ? (
        <p className="mb-4 rounded bg-red-100 p-2 text-sm text-red-800">
          Falsches Passwort. Bitte versuchen Sie es erneut.
        </p>
      ) : null}
      <form action={login} className="flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="password">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="rounded border border-gray-300 p-2"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 p-2 font-medium text-white hover:bg-blue-700"
        >
          Anmelden
        </button>
      </form>
    </main>
  );
}
