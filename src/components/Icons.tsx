import type { JSX } from 'solid-js';

interface IconProps {
  size?: number;
  class?: string;
}

const baseProps = (size = 18): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.9,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});

export const IconPlus = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconPin = (p: IconProps & { filled?: boolean }) => (
  <svg {...baseProps(p.size)} class={p.class} fill={p.filled ? 'currentColor' : 'none'}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconPen = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

export const IconHighlighter = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </svg>
);

export const IconEraser = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

export const IconLine = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M5 19 19 5" />
  </svg>
);

export const IconArrow = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M5 19 19 5" />
    <path d="M10 5h9v9" />
  </svg>
);

export const IconRect = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
  </svg>
);

export const IconEllipse = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <ellipse cx="12" cy="12" rx="9" ry="7" />
  </svg>
);

export const IconUndo = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

export const IconRedo = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export const IconUpload = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

export const IconSidebar = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

export const IconSplit = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </svg>
);

export const IconText = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M4 7V5h16v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </svg>
);

export const IconPalette = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const IconSun = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

export const IconMoon = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

export const IconEye = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconEdit = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
  </svg>
);

export const IconStylus = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m14.5 4.5 5 5" />
    <path d="M3 21l4.5-1.5L20 7a2.12 2.12 0 0 0-3-3L4.5 16.5Z" />
    <path d="M2 22h5" />
  </svg>
);

export const IconZoomIn = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </svg>
);

export const IconZoomOut = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M8 11h6" />
  </svg>
);

export const IconX = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconCheckSquare = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

export const IconList = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const IconCode = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </svg>
);

export const IconQuote = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
  </svg>
);

export const IconGrid = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

export const IconMove = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconImage = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);

export const IconPointer = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
  </svg>
);

export const IconBringFront = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2" />
  </svg>
);

export const IconSendBack = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="4" y="4" width="12" height="12" rx="2" />
    <path d="M16 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-2" />
  </svg>
);

export const IconPages = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="6" rx="1.5" />
    <rect x="14" y="13" width="7" height="8" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconSwap = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m16 3 4 4-4 4" />
    <path d="M20 7H4" />
    <path d="m8 21-4-4 4-4" />
    <path d="M4 17h16" />
  </svg>
);

export const IconRuler = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 6v4M12 6v3M17 6v4" />
  </svg>
);

export const IconFolder = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);

export const IconFolderPlus = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M12 10v6M9 13h6" />
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconChevronUp = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m18 15-6-6-6 6" />
  </svg>
);

export const IconGrip = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconHome = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6.5h5V21" />
  </svg>
);

export const IconSparkles = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
);

export const IconFileText = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

export const IconFileUp = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 12v6" />
    <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 .99-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51.99H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </svg>
);

export const IconRotateCcw = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const IconSliders = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

export const IconInfinity = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
  </svg>
);

export const IconCrosshair = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <circle cx="12" cy="12" r="7" />
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </svg>
);

export const IconMaximize = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const IconExitFullscreen = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
);

export const IconClipboardPaste = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M16 4h2a2 2 0 0 1 2 2v4" />
    <path d="M21 14H11" />
    <path d="m15 10-4 4 4 4" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...baseProps(p.size)} class={p.class}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
