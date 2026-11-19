# Notizblock — Text & Stift Notes App (SolidJS)

Eine schnelle, lokale Web-Notiz-App mit **Markdown-Texteditor** und **druckempfindlicher Stifteingabe (Canvas)** — gebaut mit **SolidJS**, **TypeScript** und **Vite**.

**Live-Demo (GitHub Pages):** https://lebkuchen-1.github.io/html-notes/

---

## Funktionsumfang

### Startseite & Organisation
- **Startseite / Übersichtsseite**: Fester **Übersicht**-Tab ganz links mit tageszeitabhängiger Begrüßung, Live-Statistiken (*Notizen, Seiten, Ordner*), globaler Suche über Notizen, Canvas-Texte & Tags, Filter-/Sortierfunktionen und Live-Canvas-Vorschaukarten.
- **Schnellstart & Vorlagen**: Ein-Klick-Start für *Leere Notiz (A4)*, *16:9 Whiteboard*, *Meeting & Checkliste*, *Blaupause-Skizze* sowie direkten *PDF-/Bild-Import*.
- **Notiz-Tabs**: Mehrere Notizen gleichzeitig in Tabs geöffnet halten, per Drag & Drop umsortieren und persistent speichern.
- **Ordner & verschachtelte Unterordner**: Farbige Ordner (8 Akzentfarben) mit beliebig tiefen Unterordnern, Drag-&-Drop-Sortierung, Ordner-Auswahl in der Kopfzeile und sicherem Löschen (Notizen gehen beim Löschen eines Ordners nicht verloren).
- **Schlanke Explorer-Seitenleiste**: Hierarchischer Ordner- & Notizbaum mit Favoriten-Sektion, Schnellfilter und Direktaktionen.

### Text-Editor (Markdown)
- **3 Ansichtsmodi**: Nahtloses Umschalten zwischen **Kombiniert** (mit verschiebbarer Trennlinie), **Nur Text** und **Nur Canvas**.
- **Formatierungsleiste**: H1, H2, Fett, Kursiv, Aufzählungen, Checklisten (`- [ ]`), Zitate, Inline-Code und Bild-Import.
- **Interaktive Vorschau**: Checklisten-Checkboxen lassen sich direkt in der Vorschau abhaken; eingefügte Bilder werden sauber gerendert.
- **Export**: Einzelne Notizen als `.md`-Datei exportieren.

### Stifteingabe & Zeichenfläche (Canvas)
- **Stift-, Touch- & Mauseingabe**: Pointer-Events-Engine mit echter Druckempfindlichkeit (`e.pressure` für Apple Pencil, Surface Pen, Wacom), `getCoalescedEvents()` für flüssige Kurven und geschwindigkeitsbasierter Strichdynamik für Maus/Touch.
- **Nur-Stift-Modus (Handballenerkennung)**: Ignoriert Touch-Eingaben beim Zeichnen und ermöglicht gleichzeitig bequemes Scrollen mit dem Finger.
- **Werkzeuge**:
  - **Auswahl-Werkzeug**: Bilder & Canvas-Texte anklicken, verschieben und skalieren
  - **Stift** & **Textmarker** (halbtransparent, unterhalb der Tinte gerendert)
  - **Text auf Canvas**: Mehrzeilige Textfelder direkt auf dem Canvas platzieren, per Drag-Handle verschieben, Schriftart (*Sans, Serif, Hand, Mono*), Größe, Fett und Farbe wählen
  - **Formen**: Linie, Pfeil, Rechteck, Ellipse
  - **Strich-Radierer**: Löscht gezielt Striche und Canvas-Texte (lässt importierte Bilder & PDF-Hintergründe unberührt)
- **Konfigurierbarer Hintergrund pro Seite**:
  - Muster: **Blanko**, **Zeilen (Liniert)**, **Kästchen (Kariert)**, **Punktraster**
  - **9 Papier-Vorlagen** (*Warmes Papier*, *Reinweiß*, *Notizblock Gelb*, *Himmelblau*, *Salbei*, *Lavendel*, *Blaupause*, *Tafelgrün*, *Nachtschiefer*)
  - Freie **Papier- & Linienfarbe** (automatische Kontrast-Anpassung der Tintenfarbe), **Abstand** (18–64 px), **Linien-Deckkraft** und optionaler **Seitenrand**.

### Individuelle Seiten, PDF- & Bild-Import
- **Kontinuierliche Seitenansicht**: Alle Seiten einer Notiz werden untereinander in einem durchlaufenden Dokument im einheitlichen Maßstab dargestellt — inklusive automatischem Scroll-Tracking.
- **Individuelle Breite & Höhe pro Seite**: Jede Seite hat ihr eigenes Format (frei einstellbar von `320 × 320 px` bis `3200 × 6000 px`, Hoch-/Querformat-Tausch sowie 8 Vorlagen wie *A4 Hoch*, *A4 Quer*, *A5*, *Quadrat*, *16:9 Whiteboard*, *Breitbild*, *Langes Blatt*, *Karte*).
- **Horizontale Seitenübersicht**: Angedockter Filmstreifen oberhalb des Dokuments mit proportionalen Live-Thumbnails, **Drag-&-Drop-Neuanordnung**, Schnell-Verschieben (`←` / `→` bzw. `↑` / `↓`), Duplizieren, Löschen und Verschieben von Seiten in andere Notizen.
- **PDF & Bilder als Seiten**: Mehrseitige PDFs (lokal im Browser via `pdfjs-dist` gerendert) und Bilder können als eigene Seiten im exakten Seitenverhältnis importiert und direkt annotiert werden — inklusive einstellbarer Hintergrund-Deckkraft.
- **Bewegliche Bilder**: Bilder lassen sich zusätzlich frei auf Seiten platzieren, proportional skalieren, in der Deckkraft anpassen und zwischen Vorder-/Hintergrund wechseln.
- **Export & Backup**: Einzelne Seiten als hochauflösendes **PNG (2×)** exportieren; automatisches lokales Speichern (`localStorage`) plus vollständiges **JSON-Backup (Export & Import)** inkl. Ordnern, Seiten, Zeichnungen und Bildern.
- **Hell- & Dunkelmodus**: Umschaltbares Farbschema mit automatischer Tinten-Kontrastanpassung.

---

## Tastenkürzel & Gesten

> Auf macOS entspricht `Strg` der Taste `Cmd (⌘)` und `Alt` der Taste `Option (⌥)`.

### Global & Tabs

| Tastenkürzel / Geste | Aktion |
| --- | --- |
| `Strg + Alt + N` | Neue Notiz in einem neuen Tab erstellen |
| `Strg + Alt + W` | Aktiven Notiz-Tab schließen |
| `Doppelklick` (freie Tab-Leiste) | Neue Notiz in einem neuen Tab öffnen |
| `Mittelklick` auf einen Tab | Tab schließen |
| `Drag & Drop` auf Tabs | Geöffnete Tabs umsortieren |
| `Mausrad` über Tab-Leiste / Seitenübersicht | Horizontal scrollen |

### Canvas & Zeichenfläche

| Tastenkürzel / Geste | Aktion |
| --- | --- |
| `Strg + Z` | Rückgängig (Undo) auf der aktiven Seite *(außerhalb von Textfeldern)* |
| `Strg + Umschalt + Z` oder `Strg + Y` | Wiederholen (Redo) auf der aktiven Seite |
| `Strg + V` | Bild aus der Zwischenablage auf die aktive Seite einfügen |
| `Entf` oder `Rücktaste` | Ausgewähltes Bild auf dem Canvas entfernen |
| `Esc` | Offene Popovers (*Hintergrund / Seitenformat*), Seitenübersicht oder Bildauswahl schließen |
| `Stylus-Radierer-Taste` (gedrückt halten) | Schaltet temporär auf den Radierer um |
| `Drag & Drop` (Bild auf Seite) | Bild direkt an der Zielposition einfügen |
| `Drag & Drop` (PDF auf Canvas) | Alle Seiten der PDF-Datei als einzelne Canvas-Seiten importieren |

### Canvas-Textfeld (Inline-Bearbeitung)

| Tastenkürzel | Aktion |
| --- | --- |
| `Enter` | Zeilenumbruch im Canvas-Text |
| `Strg + Enter` | Texteingabe übernehmen und schließen |
| `Esc` | Texteingabe übernehmen und schließen |

### Markdown Text-Editor

| Tastenkürzel | Aktion |
| --- | --- |
| `Strg + B` | Markierten Text **fett** formatieren (`**…**`) |
| `Strg + I` | Markierten Text *kursiv* formatieren (`*…*`) |
| `Tab` | Einrückung (2 Leerzeichen) einfügen |
| `Strg + V` | Bild aus der Zwischenablage als Markdown-Anhang einfügen |

### Ordner & Tags

| Tastenkürzel / Geste | Aktion |
| --- | --- |
| `Enter` oder `,` *(Tag-Eingabe)* | Tag hinzufügen |
| `Enter` *(Ordner erstellen / umbenennen)* | Bestätigen |
| `Esc` *(Ordner / Tag)* | Eingabe abbrechen |
| `Drag & Drop` *(Notiz → Ordner)* | Notiz in Ordner verschieben |
| `Drag & Drop` *(Notiz → „Weitere Notizen“)* | Notiz aus Ordner herausnehmen |
| `Drag & Drop` *(Seitenkarte im Filmstreifen)* | Seitenreihenfolge ändern |

---

## Lokale Entwicklung

### Voraussetzungen
- Node.js 20+ (empfohlen: Node 22+)

### Installation & Start

```bash
npm install
npm run dev
```

Die App ist anschließend lokal unter `http://localhost:3000` erreichbar.

### Weitere Skripte

```bash
npm run typecheck   # TypeScript-Prüfung (tsc --noEmit)
npm run build       # Produktions-Build nach dist/
npm run preview     # Vorschau des Produktions-Builds
```

---

## Tech-Stack

- **[SolidJS](https://www.solidjs.com/)** — Feingranulare Reaktivität ohne Virtual DOM
- **[TypeScript](https://www.typescriptlang.org/)** — Strikte Typisierung
- **[Vite](https://vitejs.dev/)** — Schneller Dev-Server & Bundle-Build
- **[PDF.js (`pdfjs-dist`)](https://mozilla.github.io/pdf.js/)** — Lokales clientseitiges PDF-Rendering (lazy-geladen)
- **HTML5 Canvas & Pointer Events API** — Hochauflösendes HiDPI-Zeichnen mit Druckempfindlichkeit
