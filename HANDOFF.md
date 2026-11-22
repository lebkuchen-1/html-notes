# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Granularer Export für den Infinite Canvas (`src/utils/pdfWriter.ts`, `src/utils/infiniteExport.ts`, `src/components/InfiniteExportDialog.tsx`, `src/components/InfiniteExportRegionOverlay.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/DrawingCanvas.tsx`, `src/utils/canvasRenderer.ts`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **Aufruf:** Im Unendlich-Modus öffnen sowohl der Download-Button in der Werkzeugleiste als auch der neue `Export…`-Button in der Status-/Modus-Leiste den Export-Dialog (Seiten-Modus behält unverändert den schnellen 1-Klick-PNG-Export).
   - **4 Ausschnitt-/Bereichsmodi:**
     - **Aktueller Bildschirm** (Standard, berücksichtigt Zoom-Boost bei >100 % für scharfe Detail-Exports),
     - **Gesamter Inhalt** (automatische Bounding-Box aller Inhalte + wählbarer Randabstand `0 / 32 / 64 / 120 px`),
     - **Eigener Bereich** (interaktives Crop-Rahmen-Overlay direkt auf dem Infinite Canvas mit 8 Touch-Griffen, freiem Aufziehen, Seitenverhältnis-Presets `Frei / A4 Hoch / A4 Quer / 16:9 / 1:1`, `Rahmen ↔ Canvas schieben`-Modus für Pan & Pinch-Zoom sowie `Bildschirm`-/`Inhalt`-Snaps),
     - **Lasso-Auswahl** (erscheint automatisch bei aktiver Lasso-Auswahl und exportiert nur die markierten Elemente).
   - **4 Ausgabeformate (komplett offline, ohne externe PDF-Abhängigkeit):**
     - **PNG** (verlustfrei, inkl. optional transparentem Hintergrund + direkter **Zwischenablage-Kopie**),
     - **JPEG** (kompakt, wählbare Qualität `80 % / 90 % / 95 %`),
     - **PDF (1 Blatt)** (Endlos-Einzelblatt proportional in cm/pt kalibriert),
     - **PDF (Druckseiten)** (A4 Hoch/Quer, A3 Hoch/Quer, US Letter mit `Kacheln 1:1` inkl. Maßstab `75/100/125 %`, `Breite auf 1 Seite` wie OneNote oder `Alles auf 1 Seite`, Druckrand `0/10/15 mm`, optionalem **Überspringen leerer Kacheln** und Seitenzahlen).
   - **Feinere granuläre Optionen & Live-Vorschau:**
     - Hintergrund & Papier: `Wie Canvas`, `Ohne Raster`, `Weiß (Druck)` (rendert Auto-Tinte automatisch dunkel, ideal bei Dark-Mode-Notizen), `Weiß + Raster` und `Transparent` (PNG).
     - Ebenen-Filter (`Stift & Formen`, `Textmarker`, `Texte`, `Bilder`, ggf. `Hintergrund-PDF`), Auflösung (`1× / 2× / 3×` mit Safari-sicherem 16-MP-Schutz), editierbarer Dateiname sowie **Teilen**-Button (iPadOS System-Share-Sheet).
     - Live-Vorschau im Dialog zeigt alle Optionen sofort inkl. gestrichelter PDF-Seitenumbrüche und ausgegrauter leerer Kacheln.

## Offene Punkte
- Praxistest des Infinite-Canvas-Exports auf dem iPad (aktueller Bildschirm, eigener Bereich mit Touch/Apple Pencil, mehrseitiges A4-PDF, Teilen-Menü & Weiß-Druckmodus).
