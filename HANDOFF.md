# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Farbauswahl ersetzt nun die aktuell ausgewählte Farbe statt eines festen Extra-Slots am Ende (`src/components/DrawingCanvas.tsx`, `src/components/ColorPickerPopover.tsx`, `src/styles.css`):**
   - Stift- und Textmarker-Paletten werden als editierbare, persistierte Farbslots (`solid-notes:pen-palette`, `solid-notes:highlighter-palette`) samt aktivem Slot-Index (`solid-notes:pen-color-index`, `solid-notes:highlighter-color-index`) in `localStorage` gespeichert; der Extra-Slot am Ende (`is-custom-slot`) entfällt.
   - Bei geänderten Farbslots zeigt `ColorPickerPopover` im Kopf eine Zurücksetzen-Schaltfläche (`Auto` / `Standard`).
2. **iPadOS 2-Tap-Problem bei Notizen, Ordnern und Tabs behoben (`src/styles.css`, `AGENTS.md`):**
   - **Ursache:** Ungefilterte `:hover`-Regeln blendeten beim ersten Tipp versteckte Aktions-Buttons ein (`.tree-note-row:hover .tree-row-actions`, `.folder-row:hover .folder-actions`, `.note-tab:hover .note-tab-close`, `.home-note-card:hover .home-note-hover-actions`), wodurch iPadOS Safari den ersten Tipp als Hover-Enthüllung schluckte und erst beim zweiten Tipp `click` auslöste.
   - **Fix:** Alle Hover-Enthüllungsregeln in `@media (hover: hover) and (pointer: fine)` gekapselt, `touch-action: manipulation` ergänzt und unter `@media (hover: none), (pointer: coarse)` Tab-Schließen (`×`) sowie Startseiten-Kartenaktionen dauerhaft bzw. Sidebar-Notiz-/Ordner-Aktionen auf `.is-active` sichtbar gemacht.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
