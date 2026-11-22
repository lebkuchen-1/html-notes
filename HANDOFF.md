# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Interaktives Zeichenlineal & gruppierte geometrische Formen (`src/utils/ruler.ts`, `src/components/CanvasRulerOverlay.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **Gruppierte geometrische Symbole in der Toolbar:** `Linie`, `Pfeil`, `Rechteck` und `Ellipse` sind in einem kompakten Split-Button (`.shape-tool-group` analog zur 3-Stift-Gruppe) gebündelt — zeigt die zuletzt gewählte Form (persistiert in `solid-notes:shape-tool`), aktiviert sie per 1 Tipp und öffnet per erneutem Tipp oder `▾` das 2×2-Formen-Popover inkl. Linienstärken-Schnellwahl (`S`/`M`/`L`/`XL`).
   - **Interaktives physisches Lineal (`CanvasRulerOverlay.tsx` & `ruler.ts`):**
     - Über den Lineal-Button in der Toolbar oder Taste `R` ein-/ausblendbar; funktioniert einheitlich im **Seiten-Modus** und **Unendlich-Modus** über `.canvas-stage-wrapper`.
     - **Präzises Zeichnen entlang beider Kanten:** Stift (Kugelschreiber, Füllerfederhalter, Pinselstift) und Textmarker rasten beim Aufsetzen in der Kanten-Fangzone magnetisch ein und projizieren jeden Punkt exakt auf die Linealkante — Druckdynamik, Federwinkel und O(1)-120Hz-Live-Rendering bleiben vollständig erhalten, während die aktive Kante aufleuchtet und die gezeichnete Länge live in `cm` angezeigt wird.
     - **Zoom-adaptive Skala & Bedienung:** Retina-scharfe SVG-cm/mm-Skala (A4-kalibriert: `794 px = 21 cm`, passt sich live auch während Pinch-Zoom an), 1-Finger-/Maus-Verschieben, 2-Finger-Drehen + Verschieben (per `targetTouches` palm-geschützt), 1-Finger-/Pencil-Drehgriffe links/rechts, Mausrad-Drehung (`1°` / `Shift: 15°`), magnetisches Winkel-Snapping (`0°/15°/45°/90°`, mit `Alt` frei) sowie eine stets aufrechte Winkel-Kapsel mit Schnellwinkeln (`0°`, `45°`, `90°`, `-45°`) und Schließen-Button.

## Offene Punkte
- Praxistest von Lineal (2-Finger-Drehung, Kanten-Fangzone, Drehgriffe) und gruppierter Formen-Auswahl auf dem iPad mit Apple Pencil.
