# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-24 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **2-Wege-Synchronisieren im Online-Backup inkl. 3-Wege-Lösch-Abgleich (`src/utils/cloudSync.ts`, `src/components/CloudBackupDialog.tsx`, `src/store/notesStore.ts`, `src/components/SettingsPage.tsx`, `src/styles.css`):**
   - **Standard-Tab `Synchronisieren`:** Ein-Klick-Abgleich in beide Richtungen (`buildSyncPlan` / `executeCloudSync`), der neue, geänderte und gelöschte Notizen & Ordner automatisch erkennt.
   - **Lösch-Synchronisierung (Behebung „gelöschte Notizen kommen immer wieder zurück“):**
     - `classify3Way` wertet jetzt `baseline` + lokale Lösch-Tombstones (`recordLocalNoteDeletion`/`recordLocalFolderDeletion` in `deleteNote`/`deleteFolder`) + Cloud-Tombstones (`manifest.deletedNotes`/`manifest.deletedFolders`) aus und unterscheidet sauber zwischen `remote-only`, `deleted-local` (`↑ Online löschen`), `deleted-remote` (`↓ Lokal löschen`) und Lösch-vs.-Bearbeitungs-Konflikten (`conflict`).
     - Beim Synchronisieren werden lokal gelöschte Notizen aus `manifest.json` entfernt (mit Tombstone) und per `s3DeleteObject` best-effort im Bucket gelöscht; online gelöschte Notizen werden auf anderen Geräten sauber lokal entfernt (`applyCloudImport` mit `deleteNoteIds`/`deleteFolderIds`, inkl. Tab-/ActiveNote-Aufräumen).
     - Alle Löschungen werden vorab rot im Baum und in der Zusammenfassung aufgelistet; über den Tab `Importieren` lassen sich noch vorhandene Online-Notizen weiterhin ohne lokales Löschen wiederherstellen.

## Offene Punkte
- Praxistest von 2-Wege-Synchronisieren inkl. Löschen zwischen zwei Geräten nach dem Deploy.
