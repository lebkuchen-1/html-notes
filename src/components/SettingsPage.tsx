import { createMemo, For, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  PAGE_SIZE_PRESETS,
  type CanvasMode,
  type EditorFontFamily,
  type NoteLocalSettings,
  type PalmSensitivity,
  type PaperPattern,
  type StabilizationLevel,
  type ViewMode,
} from '../types';
import {
  estimateStorageUsageBytes,
  exportNotesAsJson,
  PAPER_PRESETS,
} from '../utils/storage';
import {
  IconArrowLeft,
  IconDownload,
  IconFileText,
  IconMoon,
  IconRotateCcw,
  IconSettings,
  IconSidebar,
  IconSliders,
  IconSun,
  IconUpload,
} from './Icons';

interface SettingsPageProps {
  store: NotesStore;
}

const CANVAS_MODE_OPTIONS: { value: CanvasMode; label: string }[] = [
  { value: 'pages', label: 'Seiten' },
  { value: 'infinite', label: 'Unendlich (OneNote)' },
];

const STABILIZATION_OPTIONS: { value: StabilizationLevel; label: string }[] = [
  { value: 'off', label: 'Aus' },
  { value: 'light', label: 'Leicht' },
  { value: 'medium', label: 'Mittel' },
];

const PALM_OPTIONS: { value: PalmSensitivity; label: string }[] = [
  { value: 'low', label: 'Niedrig' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Stark' },
];

const EDITOR_FONT_SIZES = [13, 14, 15, 16, 18, 20] as const;

const EDITOR_FONT_OPTIONS: { value: EditorFontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'split', label: 'Kombiniert' },
  { value: 'text', label: 'Text' },
  { value: 'canvas', label: 'Canvas' },
];

const PATTERN_OPTIONS: { value: PaperPattern; label: string }[] = [
  { value: 'blank', label: 'Blanko' },
  { value: 'lined', label: 'Zeilen' },
  { value: 'grid', label: 'Kästchen' },
  { value: 'dots', label: 'Punkte' },
];

const EXPORT_SCALE_OPTIONS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: '1× Standard' },
  { value: 2, label: '2× HiDPI' },
  { value: 3, label: '3× Druck' },
];

const AUTOSAVE_OPTIONS: { value: number; label: string }[] = [
  { value: 250, label: 'Schnell (250 ms)' },
  { value: 450, label: 'Normal (450 ms)' },
  { value: 1000, label: 'Ruhig (1 s)' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsPage(props: SettingsPageProps) {
  let importInputRef: HTMLInputElement | undefined;

  const isLocal = () =>
    props.store.settingsTab() === 'local' && Boolean(props.store.activeNote());

  const activeNote = () => props.store.activeNote();
  const globalSettings = () => props.store.settings();
  const currentValues = () =>
    isLocal() ? props.store.effectiveSettings() : props.store.settings();

  const isKeyOverridden = <K extends keyof NoteLocalSettings>(key: K): boolean => {
    if (!isLocal()) return false;
    return activeNote()?.settings?.[key] !== undefined;
  };

  const setShared = <K extends keyof NoteLocalSettings>(
    key: K,
    value: NoteLocalSettings[K]
  ) => {
    if (isLocal()) {
      const note = activeNote();
      if (!note) return;
      // If user picks the exact global value while not yet overridden, still allow explicit local override
      // so changing global later won't affect this note; reset button clears it back to global.
      props.store.updateNoteSettings({ [key]: value }, note.id);
    } else {
      props.store.updateSettings({ [key]: value });
    }
  };

  const resetLocalKey = <K extends keyof NoteLocalSettings>(key: K) => {
    const note = activeNote();
    if (!note) return;
    props.store.updateNoteSettings({ [key]: undefined }, note.id);
  };

  const storageStats = createMemo(() => {
    const notes = props.store.notes();
    const bytes = estimateStorageUsageBytes();
    const totalPages = notes.reduce((acc, n) => acc + n.pages.length, 0);
    const totalStrokes = notes.reduce(
      (acc, n) => acc + n.pages.reduce((pAcc, p) => pAcc + p.strokes.length, 0),
      0
    );
    const approxQuota = 5 * 1024 * 1024;
    const pct = Math.min(100, Math.round((bytes / approxQuota) * 100));
    return { bytes, totalPages, totalStrokes, pct };
  });

  const handleImportFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        props.store.importNotesFromJson(reader.result);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };

  const renderLocalMeta = <K extends keyof NoteLocalSettings>(key: K) => (
    <Show when={isLocal()}>
      <Show
        when={isKeyOverridden(key)}
        fallback={<span class="setting-scope-tag is-inherited">Global</span>}
      >
        <span class="setting-scope-tag is-local">Lokal</span>
        <button
          type="button"
          class="setting-reset-inline"
          onClick={() => resetLocalKey(key)}
          title="Auf globalen Standard zurücksetzen"
          aria-label="Auf globalen Standard zurücksetzen"
        >
          <IconRotateCcw size={12} />
        </button>
      </Show>
    </Show>
  );

  return (
    <div class="settings-page">
      {/* Sticky Top Bar */}
      <header class="settings-header">
        <div class="settings-header-left">
          <button
            type="button"
            class="icon-btn"
            onClick={() => props.store.setSidebarOpen((v) => !v)}
            title="Seitenleiste umschalten"
            aria-label="Seitenleiste umschalten"
          >
            <IconSidebar size={18} />
          </button>

          <button
            type="button"
            class="settings-back-btn"
            onClick={() => props.store.closeSettings()}
            title="Zurück (Esc)"
          >
            <IconArrowLeft size={15} />
            <span>Zurück</span>
          </button>

          <div class="settings-title-block">
            <h1 class="settings-title">
              <IconSettings size={18} />
              <span>Einstellungen</span>
            </h1>
          </div>
        </div>

        {/* Scope Switcher: Global vs Current Note */}
        <div class="settings-scope-switcher" role="tablist" aria-label="Geltungsbereich">
          <button
            type="button"
            role="tab"
            aria-selected={!isLocal()}
            class="settings-scope-btn"
            classList={{ 'is-active': !isLocal() }}
            onClick={() => props.store.setSettingsTab('global')}
          >
            <IconSliders size={14} />
            <span>Global</span>
          </button>

          <Show when={activeNote()}>
            {(curr) => (
              <button
                type="button"
                role="tab"
                aria-selected={isLocal()}
                class="settings-scope-btn"
                classList={{ 'is-active': isLocal() }}
                onClick={() => props.store.setSettingsTab('local')}
                title={`Lokale Einstellungen für „${curr().title.trim() || 'Unbenannte Notiz'}“`}
              >
                <IconFileText size={14} />
                <span class="scope-note-name">
                  {curr().title.trim() || 'Aktuelle Notiz'}
                </span>
                <Show when={props.store.activeNoteLocalOverrideCount() > 0}>
                  <span class="scope-override-badge">
                    {props.store.activeNoteLocalOverrideCount()}
                  </span>
                </Show>
              </button>
            )}
          </Show>
        </div>
      </header>

      <div class="settings-scroll">
        <div class="settings-container">
          {/* Context Info Banner */}
          <Show
            when={isLocal()}
            fallback={
              <div class="settings-scope-banner">
                <div class="ssb-text">
                  <strong>Globale Einstellungen</strong>
                  <span>
                    Gelten standardmäßig für alle Notizen. Einzelne Notizen können lokale
                    Abweichungen festlegen.
                  </span>
                </div>
                <Show when={activeNote()}>
                  {(curr) => (
                    <button
                      type="button"
                      class="btn-ghost-sm"
                      onClick={() => props.store.setSettingsTab('local')}
                    >
                      Für „{curr().title.trim() || 'Aktuelle Notiz'}“ anpassen →
                    </button>
                  )}
                </Show>
              </div>
            }
          >
            <div class="settings-scope-banner is-local-banner">
              <div class="ssb-text">
                <strong>
                  Lokale Einstellungen für „{activeNote()?.title.trim() || 'Unbenannte Notiz'}“
                </strong>
                <span>
                  Änderungen gelten nur für diese Notiz. Optionen mit dem Hinweis „Global“
                  übernehmen automatisch deine globalen Vorgaben.
                </span>
              </div>
              <Show when={props.store.activeNoteLocalOverrideCount() > 0}>
                <button
                  type="button"
                  class="btn-ghost-sm is-danger-ghost"
                  onClick={() => props.store.resetNoteSettings()}
                >
                  <IconRotateCcw size={13} />
                  <span>Alle auf Global</span>
                </button>
              </Show>
            </div>
          </Show>

          {/* SECTION 1: Stift, Handschrift & Palm Rejection */}
          <section class="settings-card">
            <div class="settings-card-head">
              <h2>Stift, Handschrift &amp; Palm Rejection</h2>
              <p>Schreibgefühl, Glättung und Handballenerkennung für Apple Pencil &amp; Stylus.</p>
            </div>

            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Schrift-Stabilisierung (Glättung)</span>
                    {renderLocalMeta('stabilization')}
                  </div>
                  <span class="setting-desc">
                    Geschwindigkeitsadaptiver One-Euro-Filter: reduziert Mikrozittern bei langsamer
                    Handschrift, erhält aber scharfe Ecken.
                  </span>
                </div>
                <div class="setting-control">
                  <div class="segmented-control">
                    <For each={STABILIZATION_OPTIONS}>
                      {(opt) => (
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{
                            'is-active': currentValues().stabilization === opt.value,
                          }}
                          onClick={() => setShared('stabilization', opt.value)}
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Druckempfindlichkeit</span>
                    {renderLocalMeta('pressureSensitivity')}
                  </div>
                  <span class="setting-desc">
                    Passt die Strichstärke dynamisch an den Stiftdruck an. Ausgeschaltet schreibt
                    der Stift mit gleichmäßiger Linienstärke.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().pressureSensitivity}
                      onChange={(e) =>
                        setShared('pressureSensitivity', e.currentTarget.checked)
                      }
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Nur-Stift-Modus</span>
                    {renderLocalMeta('stylusOnly')}
                  </div>
                  <span class="setting-desc">
                    Blockiert das Zeichnen per Finger – der Stift schreibt, während Finger nur zum
                    Scrollen und Zoomen genutzt werden.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().stylusOnly}
                      onChange={(e) => setShared('stylusOnly', e.currentTarget.checked)}
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">1-Finger-Scrollen auf dem Blatt</span>
                    {renderLocalMeta('oneFingerScroll')}
                  </div>
                  <span class="setting-desc">
                    Erlaubt im Nur-Stift-Modus flüssiges Scrollen mit einem Finger direkt über die
                    Zeichenfläche.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().oneFingerScroll}
                      onChange={(e) => setShared('oneFingerScroll', e.currentTarget.checked)}
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Handballenschutz-Empfindlichkeit</span>
                    {renderLocalMeta('palmSensitivity')}
                  </div>
                  <span class="setting-desc">
                    Steuert, wie streng große Handflächen und leichte Handbewegungen direkt vor dem
                    Stiftaufsetzen gefiltert werden.
                  </span>
                </div>
                <div class="setting-control">
                  <div class="segmented-control">
                    <For each={PALM_OPTIONS}>
                      {(opt) => (
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{
                            'is-active': currentValues().palmSensitivity === opt.value,
                          }}
                          onClick={() => setShared('palmSensitivity', opt.value)}
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <Show when={!isLocal()}>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label-row">
                      <span class="setting-label">Automatische Stifterkennung</span>
                    </div>
                    <span class="setting-desc">
                      Aktiviert den Nur-Stift-Modus automatisch beim ersten Kontakt mit dem Apple
                      Pencil oder Stylus.
                    </span>
                  </div>
                  <div class="setting-control">
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        checked={globalSettings().autoEnableStylusOnly}
                        onChange={(e) =>
                          props.store.updateSettings({
                            autoEnableStylusOnly: e.currentTarget.checked,
                          })
                        }
                      />
                      <span class="toggle-slider" />
                    </label>
                  </div>
                </div>
              </Show>
            </div>
          </section>

          {/* SECTION 2: Canvas, Zoom & Navigation */}
          <section class="settings-card">
            <div class="settings-card-head">
              <h2>Canvas, Zoom &amp; Ansicht</h2>
              <p>Verhalten der Zeichenfläche, Gesten und Seitenanzeige.</p>
            </div>

            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Canvas-Modus</span>
                    {renderLocalMeta('canvasMode')}
                  </div>
                  <span class="setting-desc">
                    Klassische mehrseitige Dokumente oder ein endloses Whiteboard wie in OneNote.
                    Bestehende Inhalte bleiben beim Wechseln vollständig erhalten.
                  </span>
                </div>
                <div class="setting-control">
                  <div class="segmented-control">
                    <For each={CANVAS_MODE_OPTIONS}>
                      {(opt) => (
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{
                            'is-active': currentValues().canvasMode === opt.value,
                          }}
                          onClick={() => setShared('canvasMode', opt.value)}
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">2-Finger Pinch-to-Zoom</span>
                    {renderLocalMeta('pinchZoomEnabled')}
                  </div>
                  <span class="setting-desc">
                    Stufenloses Hinein- und Herauszoomen (45 % – 350 %) mit zwei Fingern. Wenn
                    aus, scrollen zwei Finger ohne zu zoomen.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().pinchZoomEnabled}
                      onChange={(e) =>
                        setShared('pinchZoomEnabled', e.currentTarget.checked)
                      }
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Scroll-Momentum (Auslaufen)</span>
                    {renderLocalMeta('scrollMomentum')}
                  </div>
                  <span class="setting-desc">
                    Lässt die Seite nach schnellem Wischen sanft weitergleiten (120-Hz-optimiert).
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().scrollMomentum}
                      onChange={(e) => setShared('scrollMomentum', e.currentTarget.checked)}
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Seiten-Kopfzeilen anzeigen</span>
                    {renderLocalMeta('showSheetHeaders')}
                  </div>
                  <span class="setting-desc">
                    Zeigt die kompakte Leiste (#1, Format, +H, Aktionen) über jedem Blatt. Zum
                    ablenkungsfreien Schreiben ausblendbar.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().showSheetHeaders}
                      onChange={(e) => setShared('showSheetHeaders', e.currentTarget.checked)}
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>

              <Show when={!isLocal()}>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label-row">
                      <span class="setting-label">Standard-Ansicht für neue Notizen</span>
                    </div>
                    <span class="setting-desc">
                      Legt fest, ob neue Notizen im Kombiniert-, Text- oder Canvas-Modus starten.
                    </span>
                  </div>
                  <div class="setting-control">
                    <div class="segmented-control">
                      <For each={VIEW_MODE_OPTIONS}>
                        {(opt) => (
                          <button
                            type="button"
                            class="seg-btn"
                            classList={{
                              'is-active': globalSettings().defaultViewMode === opt.value,
                            }}
                            onClick={() =>
                              props.store.updateSettings({ defaultViewMode: opt.value })
                            }
                          >
                            {opt.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </section>

          {/* SECTION 3: Texteditor (Markdown) */}
          <section class="settings-card">
            <div class="settings-card-head">
              <h2>Texteditor (Markdown)</h2>
              <p>Lesbarkeit und Verhalten im Textbereich sowie in der Markdown-Vorschau.</p>
            </div>

            <div class="settings-list">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Schriftgröße</span>
                    {renderLocalMeta('editorFontSize')}
                  </div>
                  <span class="setting-desc">Textgröße im Editor und in der Vorschau.</span>
                </div>
                <div class="setting-control">
                  <div class="segmented-control">
                    <For each={EDITOR_FONT_SIZES}>
                      {(sz) => (
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{
                            'is-active': currentValues().editorFontSize === sz,
                          }}
                          onClick={() => setShared('editorFontSize', sz)}
                        >
                          {sz}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Schriftart</span>
                    {renderLocalMeta('editorFontFamily')}
                  </div>
                  <span class="setting-desc">
                    Wähle zwischen moderner Sans-Serif-, klassischer Serif- oder Monospace-Schrift.
                  </span>
                </div>
                <div class="setting-control">
                  <div class="segmented-control">
                    <For each={EDITOR_FONT_OPTIONS}>
                      {(opt) => (
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{
                            'is-active': currentValues().editorFontFamily === opt.value,
                          }}
                          onClick={() => setShared('editorFontFamily', opt.value)}
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-label-row">
                    <span class="setting-label">Rechtschreibprüfung</span>
                    {renderLocalMeta('editorSpellCheck')}
                  </div>
                  <span class="setting-desc">
                    Browser-Rechtschreibprüfung im Markdown-Textfeld aktivieren.
                  </span>
                </div>
                <div class="setting-control">
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={currentValues().editorSpellCheck}
                      onChange={(e) => setShared('editorSpellCheck', e.currentTarget.checked)}
                    />
                    <span class="toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 4 (Global only): Standard-Papier & Seitenformat */}
          <Show when={!isLocal()}>
            <section class="settings-card">
              <div class="settings-card-head">
                <h2>Standard für neue Notizen</h2>
                <p>Voreingestelltes Seitenformat und Papierdesign beim Erstellen neuer Notizen.</p>
              </div>

              <div class="settings-list">
                <div class="setting-row is-stacked">
                  <div class="setting-info">
                    <span class="setting-label">Standard-Seitenformat</span>
                    <span class="setting-desc">
                      Breite und Höhe der ersten Seite bei jeder neu angelegten Notiz.
                    </span>
                  </div>
                  <div class="settings-preset-chips">
                    <For each={PAGE_SIZE_PRESETS}>
                      {(preset) => (
                        <button
                          type="button"
                          class="settings-chip"
                          classList={{
                            'is-active':
                              globalSettings().defaultPagePresetId === preset.id,
                          }}
                          onClick={() =>
                            props.store.updateSettings({ defaultPagePresetId: preset.id })
                          }
                        >
                          <span>{preset.shortLabel}</span>
                          <small>
                            {preset.width}×{preset.height}
                          </small>
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">Standard-Papiermuster</span>
                    <span class="setting-desc">Blanko, Zeilen, Kästchen oder Punktraster.</span>
                  </div>
                  <div class="setting-control">
                    <div class="segmented-control">
                      <For each={PATTERN_OPTIONS}>
                        {(opt) => (
                          <button
                            type="button"
                            class="seg-btn"
                            classList={{
                              'is-active':
                                globalSettings().defaultPaperConfig.pattern === opt.value,
                            }}
                            onClick={() =>
                              props.store.updateDefaultPaperConfig({ pattern: opt.value })
                            }
                          >
                            {opt.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                <div class="setting-row is-stacked">
                  <div class="setting-info">
                    <span class="setting-label">Standard-Papierfarbe</span>
                    <span class="setting-desc">
                      Wähle eine der Papier-Vorlagen für neue Notizen.
                    </span>
                  </div>
                  <div class="settings-paper-swatches">
                    <For each={PAPER_PRESETS}>
                      {(preset) => {
                        const isSelected = () =>
                          globalSettings().defaultPaperConfig.backgroundColor.toLowerCase() ===
                          preset.previewBg.toLowerCase();
                        return (
                          <button
                            type="button"
                            class="settings-paper-pill"
                            classList={{ 'is-active': isSelected() }}
                            onClick={() =>
                              props.store.updateDefaultPaperConfig({
                                backgroundColor: preset.config.backgroundColor,
                                lineColor: preset.config.lineColor,
                                lineOpacity: preset.config.lineOpacity,
                              })
                            }
                          >
                            <span
                              class="spp-swatch"
                              style={{ background: preset.previewBg }}
                            />
                            <span>{preset.label}</span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>

                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">
                      Standard-Linienabstand ({globalSettings().defaultPaperConfig.spacing} px)
                    </span>
                    <span class="setting-desc">Abstand für Zeilen, Kästchen oder Punkte.</span>
                  </div>
                  <div class="setting-control">
                    <input
                      type="range"
                      class="settings-range"
                      min={18}
                      max={64}
                      step={2}
                      value={globalSettings().defaultPaperConfig.spacing}
                      onInput={(e) =>
                        props.store.updateDefaultPaperConfig({
                          spacing: Number(e.currentTarget.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">Randlinie standardmäßig anzeigen</span>
                    <span class="setting-desc">
                      Rote vertikale Seitenrandlinie auf neuen Seiten aktivieren.
                    </span>
                  </div>
                  <div class="setting-control">
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        checked={globalSettings().defaultPaperConfig.showMargin}
                        onChange={(e) =>
                          props.store.updateDefaultPaperConfig({
                            showMargin: e.currentTarget.checked,
                          })
                        }
                      />
                      <span class="toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* SECTION 5 (Global only): Darstellung, Export & Speicher */}
            <section class="settings-card">
              <div class="settings-card-head">
                <h2>Darstellung, Export &amp; Speicher</h2>
                <p>App-Theme, PNG-Exportqualität, Autosave und lokale Datensicherung.</p>
              </div>

              <div class="settings-list">
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">Farbschema</span>
                    <span class="setting-desc">
                      Zwischen hellem und dunklem Design wechseln.
                    </span>
                  </div>
                  <div class="setting-control">
                    <div class="segmented-control">
                      <button
                        type="button"
                        class="seg-btn"
                        classList={{ 'is-active': props.store.theme() === 'light' }}
                        onClick={() => {
                          if (props.store.theme() !== 'light') props.store.toggleTheme();
                        }}
                      >
                        <IconSun size={13} />
                        <span>Hell</span>
                      </button>
                      <button
                        type="button"
                        class="seg-btn"
                        classList={{ 'is-active': props.store.theme() === 'dark' }}
                        onClick={() => {
                          if (props.store.theme() !== 'dark') props.store.toggleTheme();
                        }}
                      >
                        <IconMoon size={13} />
                        <span>Dunkel</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">PNG-Export-Auflösung</span>
                    <span class="setting-desc">
                      Höhere Faktoren erzeugen schärfere Bilder, aber größere Dateien.
                    </span>
                  </div>
                  <div class="setting-control">
                    <div class="segmented-control">
                      <For each={EXPORT_SCALE_OPTIONS}>
                        {(opt) => (
                          <button
                            type="button"
                            class="seg-btn"
                            classList={{
                              'is-active': globalSettings().pngExportScale === opt.value,
                            }}
                            onClick={() =>
                              props.store.updateSettings({ pngExportScale: opt.value })
                            }
                          >
                            {opt.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label">Autosave-Verzögerung</span>
                    <span class="setting-desc">
                      Wartezeit nach dem letzten Strich/Tastendruck vor dem Speichern im Browser.
                    </span>
                  </div>
                  <div class="setting-control">
                    <div class="segmented-control">
                      <For each={AUTOSAVE_OPTIONS}>
                        {(opt) => (
                          <button
                            type="button"
                            class="seg-btn"
                            classList={{
                              'is-active': globalSettings().autosaveDelayMs === opt.value,
                            }}
                            onClick={() =>
                              props.store.updateSettings({ autosaveDelayMs: opt.value })
                            }
                          >
                            {opt.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                <div class="setting-row is-stacked">
                  <div class="storage-meter-head">
                    <span class="setting-label">Lokaler Browser-Speicher</span>
                    <span class="storage-meter-stats">
                      {formatBytes(storageStats().bytes)} · {props.store.notes().length} Notizen ·{' '}
                      {storageStats().totalPages} Seiten · {storageStats().totalStrokes} Striche
                    </span>
                  </div>
                  <div class="storage-meter-bar">
                    <div
                      class="storage-meter-fill"
                      classList={{ 'is-warn': storageStats().pct > 75 }}
                      style={{ width: `${Math.max(2, storageStats().pct)}%` }}
                    />
                  </div>
                  <div class="settings-footer-actions">
                    <button
                      type="button"
                      class="tool-pill"
                      onClick={() => {
                        exportNotesAsJson(
                          props.store.notes(),
                          props.store.folders(),
                          props.store.settings()
                        );
                        props.store.showToast('JSON-Backup exportiert');
                      }}
                    >
                      <IconDownload size={14} />
                      <span>JSON-Backup exportieren</span>
                    </button>
                    <button
                      type="button"
                      class="tool-pill"
                      onClick={() => importInputRef?.click()}
                    >
                      <IconUpload size={14} />
                      <span>Backup importieren</span>
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept="application/json,.json"
                      class="sr-only"
                      onChange={handleImportFile}
                    />
                    <button
                      type="button"
                      class="btn-ghost-sm is-danger-ghost"
                      onClick={() => props.store.resetSettings()}
                    >
                      <IconRotateCcw size={13} />
                      <span>Globale Einstellungen zurücksetzen</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </Show>
        </div>
      </div>
    </div>
  );
}
