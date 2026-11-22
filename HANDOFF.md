# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Lasso-Werkzeug für Seiten- & Unendlich-Canvas (`src/utils/lasso.ts`, `src/components/CanvasLassoOverlay.tsx`, `src/utils/canvasRenderer.ts`, `DrawingCanvas.tsx`, `CanvasPageSheet.tsx`, `InfiniteCanvasView.tsx`, `src/styles.css`):**
   - Neues **Lasso**-Werkzeug (`lasso`) direkt neben dem Auswahl-Werkzeug in der Canvas-Toolbar (mit `IconLasso`).
   - **Freihand-Einkreisen & Tap-to-Select:** Freihand-Schlinge wählt umschlossene Striche (Stift, Textmarker, Linien, Pfeile, Rechtecke, Ellipsen), Canvas-Texte und bewegliche Bilder aus (gesperrte PDF-/Bild-Seitenhintergründe bleiben unberührt). Ein kurzer Tipp wählt direkt ein einzelnes Objekt aus bzw. hebt eine aktive Auswahl auf.
   - **120Hz-Live-Verschieben & proportionales Skalieren:** Während des Ziehens/Skalierens (4 Eck-Anfasser mit vergrößerter Touch-Hitbox für iPad) blendet das statische `baseCanvas` die ausgewählten Elemente über `hiddenIds` einmalig aus, während das `liveCanvas` sie flüssig transformiert rendert und beim Loslassen als einen Undo-Schritt committed.
   - **Schwebende Aktionsleiste & seiten-/notizübergreifende Zwischenablage:** Umfärben (alle ausgewählten Striche & Texte inkl. `Auto`-Tinte & Farbwähler), Duplizieren (`Strg+D`), Kopieren (`Strg+C`), Ausschneiden (`Strg+X`), Einfügen (`Strg+V` oder Toolbar-Button — auch auf anderen Seiten/Notizen) und Löschen (`Entf`/`Rücktaste`).
   - **iPadOS & Palm Rejection:** Volle Palm Rejection beim Zeichnen der Lasso-Schlinge; innerhalb des Auswahlrahmens (`.canvas-lasso-selection`) ist Ziehen/Skalieren mit Apple Pencil und Finger möglich, außerhalb greifen weiterhin 1-Finger-Scroll und 2-Finger-Pinch-to-Zoom.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
