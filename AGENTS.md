# AGENTS.md — Notizblock (SolidJS Text & Canvas Notes App)

Kompakte Projekt- und Architektur-Referenz für neue Sessions. Hält alle getroffenen Designentscheidungen, Invarianten und Fallstricke fest.

---

## Projektübersicht

- **App:** Lokale Web-Notiz-App (**Sprache der UI: Deutsch**) mit Markdown-Texteditor und druckempfindlicher Stifteingabe (HTML5 Canvas).
- **Stack:** SolidJS (`^1.9.5`), TypeScript (`^5.8`), Vite (`^6.2`), `vite-plugin-solid`, `pdfjs-dist` (`^6.5`, lazy-geladen), handgeschriebenes CSS ohne UI-Framework.
- **Repository:** `https://github.com/lebkuchen-1/html-notes` (Branch: `main`)
- **Live-Demo (GitHub Pages):** `https://lebkuchen-1.github.io/html-notes/`
- **Entstehung:** Erstellt mit Gemini 4 Neon (Hinweis steht in `README.md`).

---

## Build, Prüfung & Deployment

- `npm run dev` — Lokaler Dev-Server auf Port `3000`
- `npm run typecheck` — `tsc --noEmit` (vor jedem Commit/Push ausführen)
- `npm run build` — Produktions-Build nach `dist/`
- `vite.config.ts`: `base: process.env.GITHUB_ACTIONS ? '/html-notes/' : './'` (wichtig, damit Assets & PDF.js-Worker auf `/html-notes/` und lokal funktionieren).
- `.github/workflows/deploy.yml`: Baut und deployt bei jedem Push auf `main` automatisch auf GitHub Pages (`build_type: workflow`).
- **Umgebungs-Hinweis:** `node`, `npm` und `gh` liegen im Host-Nix-Profil (`~/.nix-profile/bin`) und sind in einer isolierten Sandbox ohne `/nix` nicht erreichbar.

---

## Architektur & Dateien

| Datei | Verantwortung |
| --- | --- |
| `src/types.ts` | Datenmodelle: `Note`, `Folder`, `CanvasPage`, `Stroke`, `CanvasTextItem`, `CanvasImageItem`, `PageBackgroundImage`, `PaperConfig`, `PAGE_SIZE_PRESETS`, `FOLDER_COLORS`. |
| `src/store/notesStore.ts` | Zentraler SolidJS-Store (`createNotesStore`): Notizen, verschachtelte Ordner, offene Notiz-Tabs (`openTabIds`), aktiver Screen (`'home' \| 'note'`), aktive Seite, seitenbezogenes Undo/Redo (`${noteId}:${pageId}`), debounced Autosave. |
| `src/utils/storage.ts` | `localStorage`-Persistenz (`solid-notes:v1:*`), abwärtskompatible Migration (altes `note.canvas` → `pages[]`, altes `paper` → `paperConfig`), JSON-Backup v2 (`{ version: 2, folders, notes }`, liest auch alte `Note[]`-Arrays), Markdown-Export. |
| `src/utils/canvasRenderer.ts` | HiDPI-Canvas-Engine: Papierhintergrund (gebatchtes Punktraster, Kästchen mit 5er-Hauptgitter, Zeilen, Randlinie), gesperrtes `backgroundImage` (PDF/Bild), bewegliche Bilder, Textmarker unter Tinte, variable Stiftstriche (`drawPenDot`, `drawPenIncrementalSegment`), Formen, Canvas-Text, Hit-Testing, async 2× PNG-Export (`ensureImagesLoaded`). |
| `src/utils/strokeStabilizer.ts` | Geschwindigkeitsadaptiver One-Euro-Filter (`Aus` / `Leicht` [Standard] / `Mittel`) + eckenerhaltender Abschluss-Pass für ruhige Handschrift ohne fühlbare Latenz. |
| `src/utils/imageImport.ts` | Clientseitige Bildskalierung/-kompression (WebP/PNG bei Alpha, JPEG `0.84` bei Fotos) + Clipboard/DragDrop-Extraktion. |
| `src/utils/pageImport.ts` | Lazy-geladenes `pdfjs-dist` + `pdf.worker.min.mjs?url`; rendert PDF-Seiten und Bilder in eigenständige `CanvasPage`s im exakten Seitenverhältnis. |
| `src/utils/markdown.ts` | XSS-sicherer Markdown-Renderer mit anklickbaren Checklisten (`data-line-index`) und `note-img://<id>`-Bildauflösung aus `note.attachments`. |
| `src/components/HomePage.tsx` | Startseite/Übersichtsseite (fester `Übersicht`-Tab): Begrüßung, Statistiken, Suche, Schnellstart-Vorlagen (inkl. PDF/Bild-Import als neue Notiz), Ordnerkarten, Live-Canvas-Vorschaukarten. Teilt `filterMode` & `selectedFolderId` mit der Sidebar. |
| `src/components/NoteTabs.tsx` | Obere Tab-Leiste für geöffnete Notizen + fester `Übersicht`-Tab links, Drag-&-Drop-Umsortierung, Mittelklick zum Schließen, Doppelklick für neuen Tab. |
| `src/components/Sidebar.tsx` | Schlanke `252px`-Explorer-Seitenleiste: Hauptnavigation (`Startseite`, `Angepinnt`), Schnellfilter, Favoriten, einheitlicher rekursiver Ordner- & Notizbaum (Notizen leben direkt in ihren Ordnern), Drag & Drop von Notizen in Ordner / „Weitere Notizen“, Backup/Import. |
| `src/components/NoteHeader.tsx` | Kopfleiste in der Notizansicht: Titel, hierarchischer Ordner-Wähler, `#Tags`, Ansichtsmodus (`Kombiniert` / `Text` / `Canvas`), Pin, Hell-/Dunkelmodus. |
| `src/components/TextEditor.tsx` | Markdown-Editor mit Formatierungsleiste, interaktiver Vorschau, Bild-Import (Button, Drag & Drop, `Strg+V`) und `.md`-Export. |
| `src/components/DrawingCanvas.tsx` | Werkzeugleiste, konfigurierbares Papier-/Hintergrund-Popover (inkl. PDF/Bild-Hintergrund-Deckkraft), Seiten-Leiste, Format-Popover (`B × H`), angedockte horizontale `PageOverview`, kontinuierliche Scroll-Ansicht aller Seiten im einheitlichen `docScale`. |
| `src/components/CanvasPageSheet.tsx` | Einzelne Seite in der kontinuierlichen Ansicht mit **Dual-Layer-Canvas**, iPad-Palm-Rejection, Inline-Texteditor, Bild-Verschieben/Skalieren und Seiten-Kopfzeile (`#N`, `PDF`/`Bild`-Badge, `B × H`, `+H`, `↑`/`↓`, Duplizieren, Löschen). |
| `src/components/PageOverview.tsx` | Horizontaler angedockter Filmstreifen oberhalb des kontinuierlichen Dokuments mit proportionalen Live-Thumbnails, Drag-&-Drop-Seitenverschiebung (`reorderPage`), Verschieben in andere Notizen (`movePageToNote`) und einklappbarem Neue-Seite-Creator. |
| `src/components/Icons.tsx` | Inline-SVG-Icons ohne externe Icon-Abhängigkeit. |
| `src/styles.css` | Komplettes Designsystem mit CSS-Variablen für `[data-theme='light']` und `[data-theme='dark']`. |

---

## Wichtige Designentscheidungen & Invarianten (Nicht brechen!)

### 1. iPadOS Safari + Apple Pencil (Performance, Palm Rejection, Gesten & Stabilisierung)
- **Dual-Layer-Canvas in `CanvasPageSheet.tsx`:**
  - `drawing-canvas-base` (`pointer-events: none`): Statisches Blatt (Papier, PDF/Bild, fertige Striche & Texte). Wird **niemals** während `pointermove` neu gezeichnet.
  - `drawing-canvas-live` (`position: absolute; inset: 0`, normaler gecachter `2d`-Kontext — **kein** `desynchronized: true`, da WebKit-Overlays damit hängen können): Zeichnet aktive Stiftstriche **inkrementell in O(1)** (`drawPenIncrementalSegment`). Nach `pointerup` setzt `pendingLiveClearAfterBaseRender = true` das Live-Canvas erst nach dem Base-Repaint zurück (kein Flackern).
  - Backing-Store ist auf `dpr <= 2` und max. `2800px` Kantenlänge begrenzt (iPadOS-Safari-GPU-Limit).
  - Punktraster-Papier wird in einem einzigen `beginPath()` + `fill()` gebatcht.
- **Selbstheilendes Pointer-Handling (gegen zufälliges Schreib-Stoppen):**
  - `onLostPointerCapture` + `window`-Fallback (`pointerup`/`pointercancel`) stellen sicher, dass `activePointerId` niemals hängen bleibt.
  - Ein neues `pen`-`pointerdown` wird niemals durch eine verwaiste `activePointerId` blockiert: Ein hängengebliebener Vorgänger-Stiftstrich wird sauber abgeschlossen, ein vorheriger Touch-Ansatz (`< 450ms`) verworfen.
- **Palm Rejection, 2-Finger-Scroll & Pinch-to-Zoom (zentral auf `.canvas-viewport` in `DrawingCanvas.tsx`):**
  - `.drawing-canvas` **muss dauerhaft `touch-action: none` behalten** (niemals `pan-y`/`pinch-zoom` per CSS setzen!).
  - Nicht-passive Touch-/Gesture-Listener (`touchstart`/`touchmove`/`gesturestart`/`gesturechange` mit `{ passive: false }`) auf `.canvas-viewport` blockieren Safari-Scroll/Bounce auf Canvas und (bei `stylusOnly`/aktivem Stift) auch auf den äußeren Rändern.
  - **2-Finger-Gesten:** Funktionieren seitenübergreifend auf `.canvas-viewport` (ohne enge `radiusX`-Sperre, da normale Finger auf dem iPad >22px Radius melden) — reines Scrollen mit sanftem Auslaufen (Momentum) + GPU-beschleunigtes Pinch-to-Zoom (`translate3d` + `scale` auf `.canvas-zoom-stage`, 45%–350%) mit exaktem Ankerpunkt unter den Fingern.
  - Bei `pointercancel` während eines echten `pen`-Strichs wird der bereits gezeichnete Strich erhalten statt verworfen.
- **Schrift-Stabilisierung:** `StrokeStabilizer` (One-Euro-Filter, Standard: `Leicht`, umschaltbar `Aus` / `Leicht` / `Mittel`).

### 2. Seiten-, Tab- & Canvas-Konventionen
- **Seiten = kontinuierliche vertikale Ansicht** (keine Seiten-Tabs!); **Tabs oben = geöffnete Notizen** (+ fester `Übersicht`-Tab).
- Alle Seiten einer Notiz skalieren mit gemeinsamem `docScale` (bezogen auf `max(widths, 960)`), damit unterschiedliche Breiten/Höhen proportional bleiben.
- `PageOverview` ist ein **horizontaler Filmstreifen oberhalb des Dokuments** (verdeckt das Canvas nicht).
- **Radierer** löscht nur Striche und Canvas-Texte — niemals bewegliche Bilder oder gesperrte PDF-/Bild-Seitenhintergründe (`backgroundImage`).
- **Automatische Tintenfarbe (`'auto'`)** richtet sich nach der Helligkeit der gewählten Papierfarbe (`isPaperDark`), nicht nur nach dem App-Theme.
- Beim Löschen eines Ordners bleiben alle Notizen erhalten (wandern in den Elternordner oder nach `folderId: null`).

### 3. SolidJS & Library-Fallstricke
- `props` in SolidJS-Komponenten niemals destrukturieren.
- Listen mit editierbaren Inputs (`PageOverview`, `NoteTabs`, `CanvasPageSheet`-Liste) über **String-IDs** (`<For each={pageIds()}>`) iterieren, damit Objekt-Updates keinen Fokusverlust verursachen.
- Kontrollierte `<input>`/`<textarea>` (Titel, Texteditor) nur synchronisieren, wenn `el.value !== next` (verhindert Cursor-Sprünge).
- `pdfjs-dist` v6: `pdfPage.render({ canvas: offscreen, viewport })` verwenden und per `await loadingTask.destroy()` aufräumen (nicht `pdf.destroy()`).

---

## Tastenkürzel (Referenz)

- `Strg+Alt+N` / `Strg+Alt+W`: Neuer Notiz-Tab / Aktiven Tab schließen (Mittelklick schließt Tab, Doppelklick auf freie Tab-Leiste öffnet neuen Tab)
- `Strg+Z` / `Strg+Umschalt+Z` (`Strg+Y`): Undo / Redo auf aktiver Canvas-Seite
- `Strg+V`: Bild aus Zwischenablage (im Canvas oder Text-Editor)
- `Entf` / `Rücktaste`: Ausgewähltes Canvas-Bild löschen
- `Esc`: Popovers / Seitenübersicht / Bildauswahl schließen bzw. Canvas-Text übernehmen
- `Strg+Enter` (Canvas-Text): Text übernehmen (`Enter` = Zeilenumbruch)
- `Strg+B` / `Strg+I` / `Tab` (Text-Editor): Fett / Kursiv / Einrückung
