# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **DE/EN-Rechtschreibprüfung für Handschrift-zu-Text, Canvas-Texte, Notiztitel & Markdown-Editor (`src/utils/spellcheck.ts`, `public/dictionaries/`, `src/utils/canvasRenderer.ts`, `DrawingCanvas.tsx`, `NoteHeader.tsx`, `TextEditor.tsx`, `SettingsPage.tsx`):**
   - Offline-fähige Hunspell-Engine (`nspell`) mit lazy-geladenen Deutsch- & Englisch-Wörterbüchern (`public/dictionaries/{de,en}.{aff,dic}`, Cache-API-gecacht) und 3 Modi: **`DE + EN`** (gemischt, Standard), **`Deutsch`** (`de-DE`) und **`Englisch`** (`en-US`).
   - Unterstützt deutsche Komposita, Bindestrich-Wörter, englische Kontraktionen, Levenshtein-gerankte 1-Tap-Korrekturvorschläge und ein dauerhaftes **Persönliches Wörterbuch** (`+ Wörterbuch`, verwaltbar in *Einstellungen → Global*).
   - Rote Wellenlinien direkt auf gerenderten Canvas-Texten (im Seiten- & Unendlich-Modus; beim PNG-Export sauber ausgeblendet) sowie Toolbar-Fehler-Popover mit 1-Tap-Korrektur für Canvas, Notiztitel und Markdown-Editor.
   - Natives `spellcheck` + `lang` + `autocorrect="on"` auf allen Eingabefeldern (Notiztitel, Kritzeln-/Canvas-Textfeld, Texteditor) für optimales iPadOS-Kritzeln.
2. **„Handschrift → Text“-Modus (Apple Pencil Kritzeln) auf dem Canvas (`src/components/CanvasTextOverlay.tsx`, `DrawingCanvas.tsx`, `CanvasPageSheet.tsx`, `InfiniteCanvasView.tsx`):**
   - Neues Werkzeug **`H→Text`** (`scribble`) direkt neben dem Stift in der Canvas-Toolbar.
   - Flexibler Ablauf (Seiten- & Unendlich-Modus): Beim Aktivieren öffnet sich sofort ein großzügiges, transparentes Kritzeln-Feld direkt über den Papierlinien (`maxWidth`-Zeilenumbruch synchron zwischen Textarea & Canvas-Renderer); per Tipp an beliebiger Stelle auf dem Blatt startet sofort ein neuer Textblock, per `+`-Button ein Folgeblock darunter.
   - Integrierte schwebende Leiste mit Sprach-Umschalter (`DE·EN`/`DE`/`EN`), Schriftart/-größe/Fett und Live-Rechtschreib-Chip-Leiste direkt unter dem Schreibfeld.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
