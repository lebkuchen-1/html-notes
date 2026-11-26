# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-26 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **RemNote-inspiriertes Karteikartensystem mit Stellen-Verbergen & optionalen beidseitigen Karteikarten (`src/utils/flashcards.ts`, `src/components/CanvasOcclusionOverlay.tsx`, `src/components/FlashcardsPage.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/TextEditor.tsx`, `src/utils/markdown.ts`, `src/store/notesStore.ts`, `src/utils/db.ts`, `src/utils/storage.ts`, `src/utils/cloudSync.ts`, `src/styles.css`):**
   - **Canvas-Verdeckungen („Stellen verbergen“ + Beidseitige Paare `A ↔ B`):**
     - Neues Verdecken-Werkzeug (`occlusion`) im Seiten- und Unendlich-Modus zum Aufziehen/Tippen von Verdeckungsfeldern direkt über Handschrift, PDFs, Bilder oder Canvas-Text (mit vollständigem Undo/Redo).
     - Schwebende Aktionsleiste pro Feld: **Beidseitig ↔** (erstellt direkt ein verknüpftes Gegenstück **B** mit Verbindungslinie `A ↔ B` für 2 Abfragerichtungen `A→B` & `B→A`, umschaltbar auf einseitig `A→B` oder trennbar), **Gruppen (`G1`–`G3`)** zum gemeinsamen Verbergen, optionaler **Hinweis**, 6 Farben und Löschen.
     - **Direkt im Canvas üben („Sofort“ & „Erst am Ende vergleichen“) ohne separate Ansicht (`DrawingCanvas`, `CanvasOcclusionOverlay`):**
       - Über **`Im Canvas üben`** in der Canvas-Toolbar erscheint direkt oberhalb des Blatts eine kompakte Lernleiste — Antworten werden per temporärem **Übungs-Stift** (nutzt normale Stiftfarbe/Stärke & Radierer, verändert die Originalnotiz nicht) direkt über die verdeckten Stellen auf der Seite eingezeichnet (Seiten- & Unendlich-Modus).
       - **Modus `Erst am Ende` (Standard):** Alle zu beantwortenden Stellen bleiben verdeckt und Spick-Buttons sind gesperrt, bis alle Antworten eingezeichnet sind → **`Fertig → Vergleichen`** deckt alle Stellen direkt unter der eigenen Zeichnung auf.
       - **Modus `Sofort`:** Jede Stelle lässt sich direkt nach dem Schreiben per Auge-Button (`👁`) einzeln aufdecken und vergleichen.
       - **Direkt-Auswertung & Beidseitige Paare im Canvas:** `Überlagert`/`Nur Lösung`-Umschalter, Stellen-Stepper (`‹` / `›` springt direkt zur Stelle), `✓`/`✗`-Selbstbewertung direkt an jeder Box (inkl. SM-2-Sync & Live-Trefferquote), **`Falsche nochmal`** (deckt nur falsch markierte Stellen erneut zu) sowie Richtungswechsel **`A → B`** / **`B → A`** / **`Alle`** bei beidseitigen Paaren.
   - **Text-/Markdown-Karteikarten (RemNote-Syntax):**
     - Lückentext / Stellen verbergen: `{{Antwort}}`, `{{Antwort::Hinweis}}`, `{{1::Gruppe}}` (`Strg+Umschalt+C` + Toolbar-Button `{{…}}`, klickbare Aufdeck-Pills in der Markdown-Vorschau).
     - Einseitig (`Frage >> Antwort`), Rückwärts (`Antwort << Frage`) und **Beidseitig** (`Begriff <> Definition` oder `Begriff :: Definition`, erzeugt automatisch beide Richtungen).
   - **Manuelle Karteikarten & Einheitlicher Lernmodus (`FlashcardsPage`, `OcclusionStudyCanvas`, `FlashcardScratchpad`):**
     - Erreichbar über Sidebar (`Karteikarten` mit Fälligkeits-Badge), Tab-Leiste (`Karten`), Startseite und Notiz-Header.
     - Deck-Filter (Alle / Ordner inkl. Unterordner / Einzelnotiz), Quellenfilter (`Canvas-Stellen` / `Text` / `Manuell`), Modal für neue Karten (Standard mit **Beidseitig ↔**-Schalter oder Lückentext), **SM-2 Spaced Repetition** (`Nochmal`/`Schwer`/`Gut`/`Leicht` mit Intervall-Vorschau) und **Übungsmodus** (Alle üben).
     - **Direkt-im-Canvas-Antworten & Überlagerungs-Vergleich:** Bei Canvas-Verdeckungs-Karten im Lernmodus zeichnet man per Stift/Apple Pencil direkt in die blickdichten, schreibfreundlichen Verdeckungsfelder (in exakten Weltkoordinaten, inkl. Optionalgröße `S`–`XL` + Zieh-Leiste, Ausschnitt/Ganze Seite & „Andere verbergen“) und vergleicht nach dem Aufdecken direkt überlagert (`Überlagert` / `Nur Lösung`). Für Text-/Lückentext-Karten (und optional als `Extra-Feld`) steht zusätzlich `FlashcardScratchpad` mit Nebeneinander-/Untereinander-Vergleich bereit.
   - **Persistenz & Sync:** `page.occlusions` und `note.flashcards` werden normalisiert in IndexedDB v2, JSON-Backups (inkl. Lernfortschritt) und Cloud-Sync gespeichert.

## Offene Punkte
- Praxistest der Canvas-Verdeckungen (inkl. beidseitiger `A ↔ B`-Paare & Abdeckband) sowie des Karteikarten-Lernmodus auf dem iPad nach dem Deploy.
