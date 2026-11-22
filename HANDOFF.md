# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Stift-Bedienung von UI-Knöpfen im Vollbildmodus behoben (`src/store/notesStore.ts`, `src/components/DrawingCanvas.tsx`, `src/components/InfiniteCanvasView.tsx`):**
   - **Ursache:** `handleFullscreenTouchMoveGuard` rief im Vollbildmodus auf `document`-Ebene `e.preventDefault()` bei jedem `touchmove` auf UI-Leisten/Knöpfen auf. Da der Apple Pencil fast bei jedem Tippen minimale Sub-Pixel-`touchmove`-Events erzeugt, unterdrückte iPadOS WebKit dadurch das synthetische `click`-Event auf allen UI-Buttons.
   - **Fix:** `handleFullscreenTouchMoveGuard` ignoriert nun konsequent Stylus-Touches (`touchType === 'stylus'`), alle interaktiven Steuerelemente (`button`, `a`, `input`, `select`, `textarea`, `label`, `[role="button"]`, `[role="tab"]`, …), korrigierte scrollbare Container (inkl. `.page-filmstrip`) sowie kleinen Tap-Jitter (`< 10px`), sodass nur echte Finger-Overscroll-Wischgesten auf leerer UI-Chrome abgefangen werden.
   - **WebKit-Textknoten-Härtung:** `getTargetElement` löst `TouchEvent.target` sowohl im Fullscreen-Guard als auch in `DrawingCanvas.tsx` und `InfiniteCanvasView.tsx` sauber über `target.parentElement` auf, falls WebKit bei einem Tipp auf Button-Beschriftungen einen `Text`-Knoten als Event-Target liefert.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
