/**
 * How this person looks at and works on the document: the camera, the
 * tool and its options, the foreground and background colors, and the
 * brush. None of it is shared or saved.
 */

import {
  type Camera,
  fitRect,
  type Point,
  panBy,
  type Size,
  stepZoom,
  zoomAt,
} from '@app/features/block-fig/core/camera';
import type { GradientKind, Rgb } from '@core/psd-engine/types';
import { createSignal } from 'solid-js';
import { type BrushSettings, DEFAULT_BRUSH } from '../core/brush';
import { BLACK, WHITE } from '../core/color';
import type { DocSize } from '../core/tiles';
import { groupOf, TOOL_GROUPS, type Tool, toolForKey } from '../core/tools';

/** Options of the selection, fill, and type tools. */
export interface ToolOptions {
  /** Move: picks the layer under the pointer. */
  autoSelect: boolean;
  /** Magic Wand and Paint Bucket: color tolerance in levels. */
  tolerance: number;
  /** Only connected pixels. */
  contiguous: boolean;
  /** Compare the merged image rather than the active layer. */
  sampleAll: boolean;
  antialias: boolean;
  /** Marquee and lasso feather, in pixels. */
  feather: number;
  gradient: GradientKind;
  /** Type: size of new text, in points. */
  fontSize: number;
  /** Type: PostScript name of new text's font. */
  font: string;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  autoSelect: true,
  tolerance: 32,
  contiguous: true,
  sampleAll: false,
  antialias: true,
  feather: 0,
  gradient: 'linear',
  fontSize: 48,
  font: 'Inter-Regular',
};

/** Zooming to fit never magnifies small documents past this on opening. */
const OPEN_MAX_ZOOM = 1;

export function createPsdView(options: { docSize: () => DocSize }) {
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewport] = createSignal<Size>({ w: 0, h: 0 });
  const [dpr, setDpr] = createSignal(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  );
  const [tool, setToolSignal] = createSignal<Tool>('move');
  const [remembered, setRemembered] = createSignal<
    Partial<Record<string, Tool>>
  >({});
  const [foreground, setForeground] = createSignal<Rgb>(BLACK);
  const [background, setBackground] = createSignal<Rgb>(WHITE);
  const [brush, setBrushSignal] = createSignal<BrushSettings>(DEFAULT_BRUSH);
  const [toolOptions, setToolOptionsSignal] =
    createSignal<ToolOptions>(DEFAULT_TOOL_OPTIONS);
  const [pixelGrid, setPixelGrid] = createSignal(true);
  let fitted = false;

  const docRect = () => {
    const d = options.docSize();
    return { x: 0, y: 0, w: d.width, h: d.height };
  };

  const fit = (maxZoom: number) => {
    const v = viewport();
    if (v.w <= 0 || v.h <= 0) return;
    setCamera(fitRect(docRect(), v, maxZoom));
  };

  const setTool = (next: Tool) => {
    setToolSignal(next);
    setRemembered((r) => ({ ...r, [groupOf(next).key]: next }));
  };

  const center = (): Point => ({ x: viewport().w / 2, y: viewport().h / 2 });

  return {
    camera,
    setCamera,
    viewport,
    dpr,
    setDpr,
    /** The canvas element was resized; the first size fits the document. */
    resize(size: Size) {
      setViewport(size);
      if (!fitted && size.w > 0 && size.h > 0) {
        fitted = true;
        fit(OPEN_MAX_ZOOM);
      }
    },
    tool,
    setTool,
    /** The tool a group's button shows: the one in use, else its last used. */
    shownTool(groupKey: string): Tool {
      const group = TOOL_GROUPS.find((g) => g.key === groupKey);
      if (!group) return 'move';
      if (group.tools.includes(tool())) return tool();
      return remembered()[groupKey] ?? group.tools[0];
    },
    /** A tool letter (Shift cycles through its group). */
    chooseToolKey(key: string, cycle: boolean) {
      const next = toolForKey(key, cycle, tool(), remembered());
      if (next) setTool(next);
      return next;
    },
    foreground,
    setForeground,
    background,
    setBackground,
    swapColors() {
      const f = foreground();
      setForeground(background());
      setBackground(f);
    },
    resetColors() {
      setForeground(BLACK);
      setBackground(WHITE);
    },
    brush,
    setBrush(patch: Partial<BrushSettings>) {
      setBrushSignal((b) => ({ ...b, ...patch }));
    },
    toolOptions,
    setToolOptions(patch: Partial<ToolOptions>) {
      setToolOptionsSignal((o) => ({ ...o, ...patch }));
    },
    pixelGrid,
    setPixelGrid,
    zoomTo(zoom: number, anchor: Point = center()) {
      setCamera((c) => zoomAt(c, zoom, anchor));
    },
    zoomBy(factor: number, anchor: Point) {
      setCamera((c) => zoomAt(c, c.zoom * factor, anchor));
    },
    zoomStep(direction: 1 | -1, anchor: Point = center()) {
      setCamera((c) => zoomAt(c, stepZoom(c.zoom, direction), anchor));
    },
    pan(dx: number, dy: number) {
      setCamera((c) => panBy(c, dx, dy));
    },
    /** Fit on Screen (⌘0). */
    zoomToFit() {
      fit(Number.POSITIVE_INFINITY);
    },
    /** 100% (⌘1), keeping the view's center. */
    zoom100() {
      setCamera((c) => zoomAt(c, 1, center()));
    },
    /** Shows a canvas rectangle. */
    zoomToRect(rect: { x: number; y: number; w: number; h: number }) {
      const v = viewport();
      if (v.w > 0) setCamera(fitRect(rect, v));
    },
  };
}

export type PsdView = ReturnType<typeof createPsdView>;
