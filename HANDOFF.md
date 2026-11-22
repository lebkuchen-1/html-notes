# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Offline-Rechtschreibprüfung (`b0771dd`-Teilrevert) entfernt, „Handschrift → Text“ (`scribble`) behalten & Plattform-Grenze dokumentiert:**
   - **Entfernt:** `src/utils/spellcheck.ts`, `public/dictionaries/*` (~1,7 MB DE/EN Hunspell-Wörterbücher), `nspell`-Abhängigkeit (`package.json`, `package-lock.json`, `src/vite-env.d.ts`), rote Wellenlinien im Canvas (`src/utils/canvasRenderer.ts`, `src/utils/lasso.ts`), Spellcheck-Popovers/-Chips/-Einstellungen in `DrawingCanvas.tsx`, `CanvasTextOverlay.tsx`, `CanvasPageSheet.tsx`, `InfiniteCanvasView.tsx`, `NoteHeader.tsx`, `TextEditor.tsx`, `SettingsPage.tsx`, `notesStore.ts`, `storage.ts`, `types.ts`, `Icons.tsx` und `styles.css`.
   - **Beibehalten:** Das `scribble`-Werkzeug („Handschrift → Text“ über natives iPadOS Apple Pencil Kritzeln in `CanvasTextOverlay.tsx` inkl. Wortumbruch via `maxWidth` & `layoutCanvasTextLines`) sowie die native Browser-Rechtschreibprüfung im Markdown-Editor (`editorSpellCheck`).
   - **Dokumentiert (`AGENTS.md`):** Festgehalten, warum eine reine Offline-Rechtschreibprüfung für handgeschriebene Canvas-Striche (`Stroke[]`) nicht funktioniert, warum klassische Bild-OCR an Schreibschrift & variierenden Schriftgrößen scheitert und welche Optionen/Grenzen auf iPadOS Safari für echte Handschrifterkennung bestehen.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
