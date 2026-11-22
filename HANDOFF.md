# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Drei eigene Stiftarten hinzugefügt — Kugelschreiber, Füllerfederhalter & Pinselstift (`src/utils/penEngine.ts`, `src/types.ts`, `src/utils/canvasRenderer.ts`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/components/DrawingCanvas.tsx`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **Datenmodell & Abwärtskompatibilität (`src/types.ts`, `src/utils/strokeStabilizer.ts`, `src/utils/lasso.ts`):** `PenStyle = 'ballpoint' | 'fountain' | 'brush'`, optionale Strich-Metadaten (`penStyle`, `nibAngle`, `nibFlatness`, `brushDynamics`) auf `Stroke` sowie optionale relative Zeitstempel `t` auf `StrokePoint` (durch Stabilizer & Lasso-Operationen erhalten). Bestehende ältere Striche (`penStyle === undefined`) behalten exakt ihr bisheriges Aussehen.
   - **Stift-Engine (`src/utils/penEngine.ts`):**
     - **Kugelschreiber (`ballpoint`):** Gleichmäßige, präzise Linie (`0.88 + pressure * 0.20`) mit minimaler Drucknuance und eigener Standardstärke (`2.6 px`).
     - **Füllerfederhalter (`fountain`):** Elliptischer Kalligrafie-Federwinkel (Standard `40°` Rechtshänder, umschaltbar auf `20°`, `60°`, `140°` Linkshänder + einstellbarer Feder-Kontrast `18–78 %`), Druck- & Tempo-Tintenfluss, schräge Feder-Punkte bei Einzeltipps und sanft verjüngter Auslauf.
     - **Pinselstift (`brush`):** Nichtlineare Druckkurve (`p^1.32`, anpassbare Dynamik `55–145 %`), Tempo-Modulation sowie spitzer An- und Auslauf; Apple-Pencil-Druck-Untergrenze auf `0.05` gesenkt für feine Haarlinien.
     - **O(1)-120Hz-Live-Rendering:** Neue Bitangenten-Kapsel-Geometrie (`fillTaperedCapsule`) für nahtlose variable Breitenübergänge ohne Perlen-/Stufen-Artefakte im Seiten- wie im Unendlich-Modus.
   - **Toolbar & Popover (`src/components/DrawingCanvas.tsx`):** Direkte 3-Stift-Gruppe (1 Tipp pro Stift) + Stift-Optionen-Popover (durch nochmaliges Tippen auf den aktiven Stift oder `▾`) mit live gerenderten Canvas-Vorschaukurven, eigener persistierter Strichstärke pro Stiftart (`solid-notes:pen-widths`) und separater Formen-Strichstärke.

## Offene Punkte
- Praxistest der drei Stiftarten (Kugelschreiber, Füllerfederhalter, Pinselstift) auf dem iPad mit Apple Pencil — bei Bedarf anschließendes Feintuning von Druckkurven, Feder-Kontrast oder Auslauf.
