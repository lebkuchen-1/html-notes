# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Stift-Bedienung von UI-Knöpfen im Vollbildmodus & Kritzeln-Magnetzone behoben (`src/store/notesStore.ts`, `src/components/NoteHeader.tsx`, `src/components/ColorPickerPopover.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/Sidebar.tsx`, `src/styles.css`):**
   - `handleFullscreenTouchMoveGuard` lässt Stylus-Touches (`touchType === 'stylus'`), interaktive Elemente, scrollbare Bereiche und Tap-Jitter (`< 10px`) durch.
   - **iPadOS-Scribble-Schutz für UI-Knöpfe:** Da iPadOS `UIScribbleInteraction` um dauerhaft sichtbare `<input>`-Felder eine große Magnetzone zieht und Apple-Pencil-Tipps auf direkt darunterliegenden Toolbar-/Farb-Buttons in den Notiztitel umleitete, sind Notiztitel (`NoteHeader.tsx`) und Hex-Eingabe (`ColorPickerPopover.tsx`) jetzt **Click-to-Edit** (kein aktives `<input>` im Ruhezustand; Tippen öffnet das `<input>` für Tastatur & Kritzeln, `Enter`/`Esc`/`Blur` schließt es wieder). Zusätzlich wird das Suchfeld der eingeklappten Sidebar per `disabled` deaktiviert und UI-Leisten tragen `user-select: none`.
2. **Eigener iPadOS-sicherer Regenbogen-Farbwähler + persistenter eigener Farb-Knopf (`src/components/ColorPickerPopover.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasLassoOverlay.tsx`, `src/styles.css`):**
   - Eigenes HSV-Popover im `<Portal>` mit 2D-Farbfeld, Regenbogen-Farbtonregler, 16er-Palette, gespeicherten „Zuletzt“-Farben und Click-to-Edit-Hex-Feld.
   - Persistenter vollflächiger eigener Farb-Knopf (`.is-custom-slot`) direkt neben dem Regenbogen sowie `localStorage`-Persistenz der aktiven und gespeicherten Stift-/Textmarker-Farben.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
