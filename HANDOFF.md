# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Optionales inkrementelles Online-Backup & -Import über S3-kompatiblen Speicher (`src/utils/s3Client.ts`, `src/utils/cloudSync.ts`, `src/components/CloudBackupDialog.tsx`, `src/store/notesStore.ts`, `src/components/Sidebar.tsx`, `src/components/SettingsPage.tsx`, `src/App.tsx`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **Pure Web-Crypto S3-Client (AWS SigV4):** Unterstützt Cloudflare R2, Backblaze B2 und benutzerdefinierte S3-Buckets direkt im Browser ohne Backend oder externe SDKs; Zugangsdaten liegen ausschließlich lokal im Browser, inkl. Verbindungstest und 1-Klick-CORS-Snippets.
   - **Pro-Notiz + Content-Addressable Media-Blobs + Gzip:** Trennt Notizen (`notes/<id>.json.gz`) von deduplizierten Binär-Medien (`blobs/<sha256>`, ohne +33 % Base64-Overhead) — ideal für 430 MB+ Workspaces mit vielen PDF-Seiten/Bildern; lädt/lädt herunter Notiz für Notiz (RAM-schonend auf iPadOS) mit periodischen Manifest-Checkpoints für Wiederaufnahme nach Abbruch.
   - **Gesamt- & Einzelauswahl + 3-Wege-Desync-Schutz:** Hierarchische Ordner-/Notiz-Auswahl (inkl. automatischer Elternordner-Mitnahme), 3-Wege-Abgleich über lokale Sync-Baseline (`Synchron`, `Neu`, `Geändert/Aktueller`, `Konflikt`), Konfliktlösungs-UI pro Eintrag & Bulk (`Lokal behalten` / `Kopie` / `Ersetzen` bzw. `Überspringen` / `Online ersetzen`) mit sicherem Standard, expliziter Vorab-Zusammenfassung aller aktualisierten/ersetzten Notizen & Ordner sowie Garantie, dass niemals lokale Notizen gelöscht oder nicht ausgewählte Cloud-Notizen entfernt werden.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
