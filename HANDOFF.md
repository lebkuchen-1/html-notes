# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Daumen-/Seitwärts-Scrollen & Richtungs-Stabilisierung (`src/utils/touchScroll.ts`, `DrawingCanvas.tsx`, `InfiniteCanvasView.tsx`):**
   - Zweistufige Palm-/Daumen-Erkennung (geometrischer Radius), sodass Daumen und schräge/seitliche Finger beim 1-Finger-Scrollen und Pinch-Zoom nicht mehr als Handballen geblockt werden.
   - Achsen-Stabilisierung (±35° Lock-Kegel mit Quer-Toleranz und sprungfreiem Breakout) für gerades vertikales & horizontales Scrollen inkl. sauberem Momentum.
2. **GoodNotes-artiger Schnellimport-Dialog (`src/components/ImportDialog.tsx`, `src/utils/clipboardImport.ts`, `notesStore.ts`):**
   - 1-Tap *Einfügen*-Zugang auf Startseite, Notiz-Header, Seitenleiste & `Strg+Umschalt+V` sowie bei *PDF / Bild* & Drag & Drop.
   - Wahl zwischen **Neue Notiz** (Titel, Ordner inkl. Inline-Ordnererstellung, Seiten/Unendlich) und **Bestehende Notiz** (durchsuchbare Liste).
3. **App-Versionscode & Cache-Reload (`vite.config.ts`, `SettingsPage.tsx`, `index.tsx`):**
   - Commit-Hash (`#...`) + Build-Zeit ganz unten in *Einstellungen → Global* inkl. 1-Tap **`Neu laden`**-Button (umgeht Home-Screen-PWA-Cache ohne IndexedDB-Datenverlust).

## Bekannter Stand / Abgehakt
- **iPadOS Safari PDF-Teilen / Kurzbefehl:** Bestätigt nicht funktionsfähig (Apple WebKit blockiert `share_target` & `application/pdf` im Clipboard; Apple Kurzbefehle liefern aus dem Safari-PDF-Viewer nur `<html class="plugin-fits-content"><embed …>`). Dauerhaft in `AGENTS.md` dokumentiert und Hinweise in `ImportDialog.tsx` ehrlich angepasst.
- **Funktionierender iPad-Workflow:** Bilder/Links/Text über *Teilen → Kopieren* → *Einfügen*; PDFs über *In „Dateien“ sichern → PDF / Bild wählen* oder *Split View Drag & Drop*.

## Offene Punkte
- Keine offenen Aufgaben — bereit für das nächste Feature nach `/clear`.
