import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next.js' Standardlimit für Server Actions liegt bei 1 MB — zu wenig
      // für Dokumente wie eine mehrseitige Hausordnung als PDF. Bewusst höher
      // als das in uploadDocument() geprüfte Limit (siehe
      // src/app/actions/documents.ts, MAX_DOCUMENT_SIZE_BYTES), damit die
      // eigene, deutsche Fehlermeldung immer zuerst greift und ein zu großer
      // Upload nie an dieser harten Framework-Grenze mit einer rohen,
      // englischen Meldung scheitert.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
