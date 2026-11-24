# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-24 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Cloud-Backup / Backblaze-B2-Hänger bei 0 B behoben (`src/utils/cloudSync.ts`, `src/utils/s3Client.ts`, `src/components/CloudBackupDialog.tsx`):**
   - **Ursache (`CompressionStream` / `DecompressionStream` Backpressure-Deadlock):** In `compressJsonPayload` und `decompressJsonPayload` wurde bisher `await writer.write(copy); await writer.close();` ausgeführt, *bevor* `new Response(cs.readable).arrayBuffer()` an der Readable-Seite zog. Sobald eine Notiz > ~16–64 KB groß war, lief der interne TransformStream-Puffer voll und das Backup hing still und ohne Konsolenfehler bei `0 B` fest.
   - **Fix (`runTransformStream`):** `cs.readable` wird jetzt zwingend parallel über `Promise.all` geleert, während `cs.writable` in 64-KB-Chunks beschrieben wird (für Gzip-Kompression **und** -Dekompression).
   - **Zusätzliche Absicherung:** 60-Sekunden-Request-Timeout in `signedS3Fetch` (`s3Client.ts`), sofortige Live-Fortschritts- & Byte-Updates nach jedem hochgeladenen Medium/Notiz sowie Vermeidung doppelter `runComparison()`-Aufrufe nach dem Speichern der Verbindung.

## Offene Punkte
- Praxistest von Cloud-Backup & -Import mit Backblaze B2 nach dem Deploy.
