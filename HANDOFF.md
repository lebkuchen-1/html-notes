# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-26 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **UI-Überarbeitung auf aufgeräumtes 2-Zeilen-Layout, integrierte Tabs & Schnellmenü (`src/components/NoteHeader.tsx`, `src/components/NoteTabs.tsx`, `src/components/DrawingCanvas.tsx`, `src/utils/canvasBridge.ts`, `src/App.tsx`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **Dauerhaft sichtbare Tabs in Zeile 1 (auch im Vollbild!):** `NoteTabs` (`Übersicht`, `Karten`, geöffnete Notizen + `+`) ist in der Notizansicht direkt in Zeile 1 (`NoteHeader`) neben dem Sidebar-Button eingebettet und wird im Vollbildmodus nicht mehr ausgeblendet. Der aktive Tab zeigt Ordner-Farbpunkt/Pin und lässt sich direkt per Klick auf den Titel (Click-to-Edit, iPadOS-Kritzeln-sicher) oder im Schnellmenü umbenennen.
   - **4 Zeilen → 2 schlanke Zeilen (normal & Vollbild):** Separate Seitenleiste (`.page-strip`) und doppelte Tab-Zeile entfallen; rechts in Zeile 1 sitzen die kompakte Seiten-/Unendlich-Pill (`1/N`, `< >`, `+` bzw. `∞ Einpassen`), Undo/Redo, der gebündelte Karteikarten-/Lernen-Button (`Im Canvas üben` + SM-2-Stapel), Vollbild-Toggle und das Schnellmenü (`⋯`).
   - **„Nur Stift“ & „Hintergrund & Papier“ im Schnellmenü (`⋯`):** Beide Schalter wurden aus Zeile 2 in das `⋯`-Schnellmenü ausgelagert (`Nur Stift` mit `An`/`Aus`-Toggle, `Hintergrund & Papier` öffnet den Konfigurator als schwebendes Popover oben rechts — ebenso wie `Seitenformat`).
   - **Zentrierte, minimalistische Zeichenleiste (Zeile 2):** Enthält nur noch reine Zeichenwerkzeuge (Stift-Split-Button, Textmarker, Radierer, Lasso, Formen-Split-Button, Text, `+`-Werkzeuge-Popover), 7 Farbpunkte + Farbwähler und Strichstärken.

## Offene Punkte
- Praxistest der integrierten Tabs (inkl. Inline-Umbenennen), der zentrierten Zeichenleiste und des Schnellmenüs (`Nur Stift`, `Hintergrund & Papier`) auf dem iPad im Hoch-/Querformat und Vollbild.
