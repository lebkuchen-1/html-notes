# HANDOFF.md — Aktueller Session-Stand

> Kurzfristige Übergabe für die nächste Session. Wird nach jeder abgeschlossenen Session überschrieben bzw. bereinigt. Langfristige Architektur- & Plattform-Regeln stehen in `AGENTS.md`.

**Stand:** 2026-11-22 · Branch `main` (alle Änderungen gebaut & auf GitHub Pages deployed)

---

## Zuletzt umgesetzt (abgeschlossen)
1. **Speicher-Architektur v2 gegen 8+ GB WebKit-IndexedDB-Bloat & Binär-Strichformat (`src/utils/strokeCodec.ts`, `src/utils/db.ts`, `src/utils/storage.ts`, `src/store/notesStore.ts`, `src/components/CanvasPageSheet.tsx`, `src/components/InfiniteCanvasView.tsx`, `src/utils/lasso.ts`, `src/components/SettingsPage.tsx`, `src/styles.css`):**
   - **Normalisierte IndexedDB v2 (`notizblock-db-v2a` / `v2b`):** Trennung in `notes` (Metadaten), `pages` (Metadaten), `strokeChunks` (binäre `Uint8Array`-Chunks à max. 64 Striche — beim Zeichnen wird nur der letzte geänderte Chunk ~1–10 KB geschrieben) und `blobs` (deduplizierte rohe `Uint8Array`-Medien statt Base64-Strings). Inaktive DB-Verbindungen schließen nach 25 s für sauberes SQLite-WAL-Checkpointing.
   - **Binärer Strich-Codec + Subpixel-Optimierung (`strokeCodec.ts`):** Druck-/geschwindigkeitsbewusstes RDP (`0,22 px` Toleranz), 0,1-px-Quantisierung, Weglassen ungenutzter `t`-Zeitstempel bei Kuli/Marker/Formen sowie Delta-ZigZag-Varint-Binärkodierung (`~80–220 B` pro Strich).
   - **Transparente Speicher-Aufschlüsselung & „Speicher komprimieren“ in den Einstellungen:** Zeigt Browser-Speicher vs. tatsächliche Nutzdaten (`Striche binär`, `PDFs & Bilder`, `Browser-DB-Altlast`) inkl. 1-Klick-Slot-Swap-Komprimierung (`v2a ↔ v2b`) zur sofortigen Speicherfreigabe auf iPadOS.
   - **V1→V2-Migrationscode nach erfolgreicher Migration wieder entfernt** (clean codebase ohne Altlasten).

## Offene Punkte
- Keine offenen Punkte.
