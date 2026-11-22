# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Speicher-Architektur v2 gegen 8+ GB WebKit-IndexedDB-Bloat & Binär-Strichformat (`src/utils/strokeCodec.ts`, `src/utils/db.ts`, `src/utils/storage.ts`, `src/store/notesStore.ts`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/utils/lasso.ts`, `src/components/SettingsPage.tsx`, `src/styles.css`):**
   - **Ursache behoben (Monolith-Write-Amplification):** Bisher wurde bei jedem Strich (450 ms Autosave) die gesamte Notiz inkl. aller Base64-PDFs/Bilder als einzelner IndexedDB-Eintrag neu geschrieben — in iPadOS Safaris SQLite-WAL-IndexedDB ohne automatisches `VACUUM` wuchs die DB dadurch auf 8+ GB an.
   - **Normalisierte IndexedDB v2 (`notizblock-db-v2a` / `v2b`):** Trennung in `notes` (Metadaten), `pages` (Metadaten), `strokeChunks` (binäre `Uint8Array`-Chunks à max. 64 Striche — beim Zeichnen wird nur der letzte geänderte Chunk ~1–10 KB geschrieben) und `blobs` (deduplizierte rohe `Uint8Array`-Medien statt Base64-Strings). Inaktive DB-Verbindungen schließen nach 25 s für sauberes SQLite-WAL-Checkpointing.
   - **Binärer Strich-Codec + Subpixel-Optimierung (`strokeCodec.ts`):** Druck-/geschwindigkeitsbewusstes RDP (`0,22 px` Toleranz, verlustfrei fürs Auge, reduziert v. a. Lineal-/Geraden-/Schriftpunkte stark), 0,1-px-Quantisierung, Weglassen ungenutzter `t`-Zeitstempel bei Kuli/Marker/Formen sowie Delta-ZigZag-Varint-Binärkodierung (`~80–220 B` pro Strich, ~20–40× kleiner als JS-Objekte/JSON).
   - **Automatische verlustfreie Migration & Bereinigung:** Beim ersten Laden werden bestehende Daten aus der alten `notizblock-db` optimiert in `notizblock-db-v2a` migriert, per Zählung verifiziert und die alte 8-GB-Datenbank erst danach gelöscht.
   - **Transparente Speicher-Aufschlüsselung & „Speicher komprimieren“ in den Einstellungen:** Zeigt Browser-Speicher vs. tatsächliche Nutzdaten (`Striche binär`, `PDFs & Bilder`, `Browser-DB-Altlast`) inkl. 1-Klick-Slot-Swap-Komprimierung (`v2a ↔ v2b`) zur sofortigen Speicherfreigabe auf iPadOS. Kompaktes JSON-Backup ohne `null, 2`-Einrückungs-Overhead.

## Offene Punkte
- Praxistest auf dem iPad: App neu laden (Einstellungen → „Neu laden“), prüfen dass die automatische V1→V2-Migration den 8,29-GB-Speicher drastisch schrumpft (alternativ einmal „Speicher komprimieren“ antippen) und beim Weiterzeichnen der Speicher nicht mehr pro Strich um MB anwächst.
