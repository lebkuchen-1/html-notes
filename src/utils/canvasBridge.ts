import { createSignal, type Accessor } from 'solid-js';
import type { OcclusionDisplayMode } from '../components/CanvasOcclusionOverlay';

export interface CanvasBridgeHandlers {
  toggleOverview: () => void;
  goToAdjacentPage: (delta: -1 | 1) => void;
  appendPage: () => void;
  openSizeMenu: () => void;
  openPaperMenu: () => void;
  openExportDialog: () => void;
  triggerPdfImport: () => void;
  clearPage: () => void;
  undo: () => void;
  redo: () => void;
  setCanvasMode: (mode: 'pages' | 'infinite') => void;
  fitInfiniteToContent: () => void;
  resetInfiniteView: () => void;
  startCanvasStudy: () => void;
  setOcclusionDisplayMode: (mode: OcclusionDisplayMode) => void;
  selectOcclusionTool: () => void;
}

export interface CanvasQuickBridge {
  overviewOpen: Accessor<boolean>;
  setOverviewOpenState: (v: boolean) => void;
  occlusionDisplayMode: Accessor<OcclusionDisplayMode>;
  setOcclusionDisplayModeState: (v: OcclusionDisplayMode) => void;
  totalNoteOcclusions: Accessor<number>;
  setTotalNoteOcclusionsState: (v: number) => void;
  hasCanvasContent: Accessor<boolean>;
  setHasCanvasContentState: (v: boolean) => void;
  resolvedPaperBg: Accessor<string>;
  setResolvedPaperBgState: (v: string) => void;
  registerHandlers: (handlers: CanvasBridgeHandlers) => () => void;
  getHandlers: () => CanvasBridgeHandlers | null;
}

export function createCanvasQuickBridge(): CanvasQuickBridge {
  const [overviewOpen, setOverviewOpenState] = createSignal(false);
  const [occlusionDisplayMode, setOcclusionDisplayModeState] =
    createSignal<OcclusionDisplayMode>('edit');
  const [totalNoteOcclusions, setTotalNoteOcclusionsState] = createSignal(0);
  const [hasCanvasContent, setHasCanvasContentState] = createSignal(false);
  const [resolvedPaperBg, setResolvedPaperBgState] = createSignal('#ffffff');

  let currentHandlers: CanvasBridgeHandlers | null = null;

  return {
    overviewOpen,
    setOverviewOpenState,
    occlusionDisplayMode,
    setOcclusionDisplayModeState,
    totalNoteOcclusions,
    setTotalNoteOcclusionsState,
    hasCanvasContent,
    setHasCanvasContentState,
    resolvedPaperBg,
    setResolvedPaperBgState,
    registerHandlers: (handlers) => {
      currentHandlers = handlers;
      return () => {
        if (currentHandlers === handlers) {
          currentHandlers = null;
        }
      };
    },
    getHandlers: () => currentHandlers,
  };
}
