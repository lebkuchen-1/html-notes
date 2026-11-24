# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-24 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **2-Wege-Synchronisieren im Online-Backup (`src/utils/cloudSync.ts`, `src/components/CloudBackupDialog.tsx`, `src/store/notesStore.ts`, `src/components/SettingsPage.tsx`, `src/styles.css`):**
   - **Neuer Standard-Tab `Synchronisieren`:** Öffnet direkt beim Klick auf *Online-Backup* (sobald ein Bucket verbunden ist) sowie über den neuen Button *Synchronisieren* in den Einstellungen.
   - **Ein-Klick-2-Wege-Abgleich (`buildSyncPlan` / `executeCloudSync`):** Führt neue und geänderte Notizen & Ordner automatisch in beide Richtungen zusammen — ohne Reihenfolge beachten zu müssen:
     - `remote-only` / `remote-ahead` → werden in Phase 1 heruntergeladen (`↓ Neu laden` / `↓ Laden`) und sofort lokal übernommen.
     - `local-only` / `local-ahead` → werden in Phase 2 inkrementell hochgeladen (`↑ Neu hochladen` / `↑ Hochladen`).
     - Nur echte beidseitige Änderungen (`conflict`) erscheinen im Konflikt-Panel mit Optionen pro Eintrag und als Bulk-Aktion: **Überspringen** (Standard), **Beide** (sichert Online-Version als `(Online-Kopie)` zuerst in der Cloud und lädt anschließend die lokale Version hoch — verlustfrei & ohne Folgekonflikt), **↑ Lokal** oder **↓ Online**.
   - **Sicherheit & Transparenz:** Strikte Nicht-Lösch-Garantie, getrennte Vorschau lokal & online aktualisierter Einträge, optionale Einstellungssynchronisierung (`Nicht ändern` / `↑ Hochladen` / `↓ Übernehmen`) und einheitlicher `lastSyncAt`-Zeitstempel. Die bisherigen Einweg-Tabs `Hochladen` und `Importieren` bleiben weiterhin unverändert nutzbar.

## Offene Punkte
- Praxistest von 2-Wege-Synchronisieren zwischen zwei Geräten (z. B. iPad & Desktop) nach dem Deploy.
