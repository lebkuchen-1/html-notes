# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-26 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **RemNote-inspiriertes Karteikartensystem mit Stellen-Verbergen & optionalen beidseitigen Karteikarten (`src/utils/flashcards.ts`, `src/components/CanvasOcclusionOverlay.tsx`, `src/components/FlashcardsPage.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/TextEditor.tsx`, `src/utils/markdown.ts`, `src/store/notesStore.ts`, `src/utils/db.ts`, `src/utils/storage.ts`, `src/utils/cloudSync.ts`, `src/styles.css`):**
   - **Canvas-Verdeckungen („Stellen verbergen“ + Beidseitige Paare `A ↔ B`):**
     - Neues Verdecken-Werkzeug (`occlusion`) im Seiten- und Unendlich-Modus zum Aufziehen/Tippen von Verdeckungsfeldern direkt über Handschrift, PDFs, Bilder oder Canvas-Text (mit vollständigem Undo/Redo).
     - Schwebende Aktionsleiste pro Feld: **Beidseitig ↔** (erstellt direkt ein verknüpftes Gegenstück **B** mit Verbindungslinie `A ↔ B` für 2 Abfragerichtungen `A→B` & `B→A`, umschaltbar auf einseitig `A→B` oder trennbar), **Gruppen (`G1`–`G3`)** zum gemeinsamen Verbergen, optionaler **Hinweis**, 6 Farben und Löschen.
     - **Abdeckband-Selbsttest direkt auf der Seite** (`Bearbeiten` / `Abdecken` / `Aus`): tippe verdeckte Stellen direkt auf dem Canvas zum Auf- & Zudecken an (inkl. „Alle aufdecken/zudecken“).
   - **Text-/Markdown-Karteikarten (RemNote-Syntax):**
     - Lückentext / Stellen verbergen: `{{Antwort}}`, `{{Antwort::Hinweis}}`, `{{1::Gruppe}}` (`Strg+Umschalt+C` + Toolbar-Button `{{…}}`, klickbare Aufdeck-Pills in der Markdown-Vorschau).
     - Einseitig (`Frage >> Antwort`), Rückwärts (`Antwort << Frage`) und **Beidseitig** (`Begriff <> Definition` oder `Begriff :: Definition`, erzeugt automatisch beide Richtungen).
   - **Manuelle Karteikarten & Einheitlicher Lernmodus (`FlashcardsPage`):**
     - Erreichbar über Sidebar (`Karteikarten` mit Fälligkeits-Badge), Tab-Leiste (`Karten`), Startseite und Notiz-Header.
     - Deck-Filter (Alle / Ordner inkl. Unterordner / Einzelnotiz), Quellenfilter (`Canvas-Stellen` / `Text` / `Manuell`), Modal für neue Karten (Standard mit **Beidseitig ↔**-Schalter oder Lückentext), **SM-2 Spaced Repetition** (`Nochmal`/`Schwer`/`Gut`/`Leicht` mit Intervall-Vorschau) und **Übungsmodus** (Alle üben), HiDPI-Canvas-Ausschnitt/Ganze-Seite-Ansicht & „Andere Stellen verbergen“-Schalter.
   - **Persistenz & Sync:** `page.occlusions` und `note.flashcards` werden normalisiert in IndexedDB v2, JSON-Backups (inkl. Lernfortschritt) und Cloud-Sync gespeichert.

## Offene Punkte
- Praxistest der Canvas-Verdeckungen (inkl. beidseitiger `A ↔ B`-Paare & Abdeckband) sowie des Karteikarten-Lernmodus auf dem iPad nach dem Deploy.
