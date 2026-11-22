# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Stift-Bedienung von UI-Knöpfen im Vollbildmodus & iPadOS-Kritzeln-Schutz (`src/store/notesStore.ts`, `src/components/NoteHeader.tsx`, `src/components/ColorPickerPopover.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/Sidebar.tsx`, `src/styles.css`):**
   - `handleFullscreenTouchMoveGuard` lässt Stylus-Touches (`touchType === 'stylus'`), interaktive Elemente, scrollbare Bereiche und Tap-Jitter (`< 10px`) durch.
   - **Click-to-Edit + Capture-Phase-Auto-Close:** Notiztitel (`NoteHeader.tsx`) und Hex-Eingabe (`ColorPickerPopover.tsx`) sind Click-to-Edit (mit klarem Fokusrahmen im Bearbeitungsmodus) und schließen sich per Capture-Phase `pointerdown`/`touchstart` sofort bei jedem Tipp oder Strich außerhalb (auch direkt auf dem Canvas, wo `preventDefault()` sonst ein natives `blur` unterdrücken würde). Filter-Input der eingeklappten Sidebar per `disabled` deaktiviert.
2. **Eigener iPadOS-sicherer Regenbogen-Farbwähler + persistenter eigener Farb-Knopf (`src/components/ColorPickerPopover.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasLassoOverlay.tsx`, `src/styles.css`):**
   - Eigenes HSV-Popover im `<Portal>` mit 2D-Farbfeld, Regenbogen-Farbtonregler, 16er-Palette, gespeicherten „Zuletzt“-Farben und Click-to-Edit-Hex-Feld.
   - Persistenter vollflächiger eigener Farb-Knopf (`.is-custom-slot`) direkt neben dem Regenbogen sowie `localStorage`-Persistenz der aktiven und gespeicherten Stift-/Textmarker-Farben.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
