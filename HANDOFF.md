# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-26 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **UI-Überarbeitung auf aufgeräumtes 2-Zeilen-Layout & Schnellmenü (`src/components/NoteHeader.tsx`, `src/components/DrawingCanvas.tsx`, `src/utils/canvasBridge.ts`, `src/App.tsx`, `src/components/Icons.tsx`, `src/styles.css`):**
   - **4 Zeilen → 2 schlanke Zeilen:** Die bisherige separate 4. Seitenleiste (`.page-strip`) wurde vollständig entfernt und die zuvor 2-zeilig umgebrochene Canvas-Toolbar auf eine ruhige, einzeilige Leiste verschlankt.
   - **Kompakter, inhaltsangepasster Notiztitel (`NoteHeader.tsx`):** Titel nimmt keinen gigantischen Platz mehr ein (`flex: 0 1 auto; max-width: 240px`), behält Click-to-Edit für iPadOS-Kritzeln-Schutz bei, zeigt bei Bedarf Ordner-Farbpunkt & Pin-Indikator und kapselt `:hover` strikt in `@media (hover: hover) and (pointer: fine)` (kein hängengebliebener grauer Balken auf dem iPad).
   - **Zentrierte Seiten-/Unendlich-Pill im Header:** Kompakte Seitenübersicht (`1 / N`), Vor/Zurück-Pfeile (nur bei mehreren Seiten) und `+`-Button zum Anhängen neuer Seiten bzw. `∞ Einpassen / Ursprung` im Unendlich-Modus.
   - **Einheitlicher Lern-Button (`NoteHeader.tsx`):** Karteikarten- und Verdeckungs-Steuerung zusammengeführt (kein doppeltes `Bearbeiten | Im Canvas üben | 9`-Element mehr mitten in der Zeichenleiste): Tippen auf den Karten-Button öffnet bei vorhandenen Verdeckungen direkt ein kompaktes Popover mit **`Im Canvas üben`**, **Karteikarten-Stapel (SM-2)**, **Bearbeiten / Ausblenden** und **Neue Stelle verbergen**.
   - **Schnellmenü (`⋯`) in `NoteHeader.tsx`:** Lagert seltenere Aktionen sauber strukturiert aus — Ansicht (`Canvas` / `Kombiniert` / `Text`), Canvas-Modus (`Seiten` / `Unendlich`), Ordner, Tags (jetzt auch im Vollbild zugänglich!), Anpinnen, Papier & Hintergrund, Seitenformat (`794 × 1123`), PDF/Bild-Import, Zwischenablage-Import, Export, Seite leeren, Hell-/Dunkelmodus & Einstellungen.
   - **Einzeilige Zeichenleiste (`DrawingCanvas.tsx`):** Kompakter Stift-Split-Button (aktiver Stift + Popover für Kuli/Füller/Pinsel), Textmarker, Radierer, Lasso, Formen-Split-Button, Text, **`+` (Werkzeuge & Einfügen)**-Popover (Auswählen, Handschrift → Text, Lineal mit Aktiv-Punkt, Stellen verbergen, Bild/PDF einfügen), 7 Farbpunkte + Farbwähler, Strichstärken sowie rechts kompakt Papier-Swatch & Nur-Stift-Schalter. `Seitenformat` öffnet als schwebendes Popover oben rechts.

## Offene Punkte
- Praxistest des neuen 2-Zeilen-Layouts und der Schnellmenüs (`⋯`, `+`, Karten-Popover) auf dem iPad (Hoch- & Querformat sowie Vollbild).
