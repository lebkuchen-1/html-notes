# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Vereinheitlichter granularer Export für Seiten-Modus & Infinite Canvas (`src/components/CanvasExportDialog.tsx`, `src/utils/pagesExport.ts`, `src/utils/infiniteExport.ts`, `src/utils/pdfWriter.ts`, `src/components/InfiniteExportRegionOverlay.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/DrawingCanvas.tsx`, `src/utils/canvasRenderer.ts`, `src/styles.css`):**
   - **Einheitliche Exportansicht für beide Modi:** Der Download-Button in der Werkzeugleiste öffnet jetzt sowohl im **Seiten-Modus** als auch im **Unendlich-Modus** denselben granularen Export-Dialog mit Live-Vorschau, Hintergrund-/Papier-Optionen (`Wie Canvas`, `Ohne Raster`, `Weiß (Druck)`, `Weiß + Raster`, `Transparent`), Ebenen-Filter (`Stift & Formen`, `Textmarker`, `Texte`, `Bilder`, `Hintergrund-PDF`), Auflösung (`1× / 2× / 3×`) und Dateiname.
   - **Seiten-Modus mit flexibler Seitenauswahl & Mehrseiten-PDF:**
     - **Aktuelle Seite**, **Alle Seiten**, **Bestimmte Seiten** (1-Tipp-Seitenchips + bidirektional synchronisiertes Bereichsfeld z. B. `1, 3, 7`, `1, 3 und 7` oder `1-3, 7`, inkl. `Alle` / `Nur aktuelle` / `Keine`) und **Lasso-Auswahl** (bei aktivem Lasso).
     - **Live-Vorschau mit Seitenblättern** (`‹ Seite X (i/n) ›`) durch alle gewählten Seiten.
     - **Mehrseitiges PDF** (im `Originalformat` pro Seite oder einheitlich auf `A4 / A3 / Letter` mit Druckrand & optionalen Seitenzahlen) sowie **PNG / JPEG** als `Einzelne Dateien` (inkl. Multi-File Share auf iPadOS) oder `Untereinander (1 langes Bild)`.
   - **Infinite Canvas:** Behält alle Optionen (`Aktueller Bildschirm`, `Gesamter Inhalt`, interaktiver `Eigener Bereich` auf dem Canvas, `Lasso-Auswahl`, `PNG`, `JPEG`, `PDF 1 Blatt`, `PDF Druckseiten`-Kacheln).
   - **iPadOS Home-Screen-PWA-Optimierung:** Im Standalone-iPadOS-Modus ist **`Teilen / Sichern`** (natives iPadOS Share Sheet → *In Dateien sichern*, *Fotos*, *AirDrop*) der Hauptbutton, während `Download` weiterhin direkt daneben erreichbar bleibt.

## Offene Punkte
- Praxistest der vereinheitlichten Exportansicht auf dem iPad (Seitenauswahl `1, 3, 7` als PDF, Multi-PNG-Teilen, Infinite-Canvas-Ausschnitt & iPadOS-PWA `Teilen / Sichern`).
