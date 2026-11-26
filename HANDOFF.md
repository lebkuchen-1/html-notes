# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-26 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Pointer-basiertes Drag & Drop für Ordner & Notizen in der Seitenleiste (`src/components/Sidebar.tsx`, `src/store/notesStore.ts`, `src/types.ts`, `src/utils/storage.ts`, `src/utils/db.ts`, `src/utils/cloudSync.ts`, `src/styles.css`):**
   - **Desktop (Maus) & iPadOS (Touch / Apple Pencil):** Einheitliche Pointer-Events-Engine statt fehleranfälligem HTML5-DnD — am Desktop ab `6px` Ziehweg, auf Touch (`240ms`) & Apple Pencil (`190ms`) per kurzem Gedrückthalten ohne Konflikt mit nativem Scrollen oder Tippen.
   - **Ordner verschachteln, auf oberste Ebene holen & umsortieren:** Ordner können in andere Ordner (Mitte `inside`, inkl. Zyklus-Schutz gegen Selbst-/Nachfahren-Drop), vor/nach Geschwisterordnern (`before`/`after` mit Einfügelinie & Ankerpunkt) sowie über den `Ordner`-Header bzw. die Drop-Leiste `↑ Auf oberste Ebene verschieben` wieder auf Root-Ebene gezogen werden.
   - **Notizen verschieben & umsortieren:** Notizen lassen sich in beliebige Ordner, auf `Weitere Notizen` (Ausordnen) sowie gezielt vor/nach andere Notizen (innerhalb eines Ordners oder ordnerübergreifend) ziehen; auch aus dem `Favoriten`-Abschnitt heraus.
   - **Explorer-Komfort & Persistenz:** Automatisches Aufklappen zugeklappter Ordner beim Schweben (`480ms`), Edge-Auto-Scroll am oberen/unteren Rand, `<Portal>`-Drag-Vorschau mit kontextabhängigem Aktionshinweis (auf Touch oberhalb des Fingers) und `Esc`-Abbruch. Optionale `sortOrder` auf `Folder` & `Note` wird in IndexedDB, `localStorage` und Cloud-Sync abwärtskompatibel persistiert.

## Offene Punkte
- Praxistest von Drag & Drop (Ordner verschachteln, umsortieren, Notizen verschieben/sortieren) auf dem iPad (Touch & Apple Pencil) sowie Desktop.
