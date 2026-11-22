# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Stift-Bedienung von UI-Knöpfen im Vollbildmodus behoben (`src/store/notesStore.ts`, `src/components/DrawingCanvas.tsx`, `src/components/InfiniteCanvasView.tsx`):**
   - `handleFullscreenTouchMoveGuard` ignoriert nun Stylus-Touches (`touchType === 'stylus'`), interaktive Steuerelemente, scrollbare Bereiche und Tap-Jitter (`< 10px`), sodass Apple-Pencil-Tipps auf UI-Buttons im Vollbildmodus zuverlässig `click`-Events auslösen.
2. **Eigener iPadOS-sicherer Regenbogen-Farbwähler (`src/components/ColorPickerPopover.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasLassoOverlay.tsx`, `src/styles.css`):**
   - **Ursache:** Das native `<input type="color">` (nur mit `onInput`, ohne `onChange`) ist in iPadOS Safari / Standalone-PWA & Vollbildmodus bekannt fehleranfällig (übernimmt Farbauswahlen aus dem nativen Regenbogen-Dialog oft gar nicht und zeigte keine aktive Vorschau im Toolbar-Kreis).
   - **Fix:** Durch ein eigenes, per `<Portal>` positioniertes HSV-Popover (`ColorPickerPopover`) ersetzt: 2D-Sättigungs-/Helligkeitsfläche + Regenbogen-Farbtonregler mit Pointer-Capture (120Hz-Drag mit Apple Pencil, Finger & Maus), 16er-Farbpalette, gespeicherte „Zuletzt“-Farben (`localStorage`), Hex-Eingabe sowie aktiver Farbpunkt direkt im Regenbogen-Button. Eingesetzt für Stift-/Textmarkerfarbe, Papierfarbe, Linienfarbe und Lasso-Umfärben.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
