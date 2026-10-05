import {
  type Rendered,
  renderBand,
  renderPage,
} from '@core/docx-engine/client';
import type { Band, PageInfo } from '@core/docx-engine/types';

/** The most pixels per CSS pixel a page is drawn with. */
const MAX_DPR = 2;

type PageState = {
  canvas?: HTMLCanvasElement;
  visible: boolean;
  /** Fingerprint of what the canvas shows (`undefined` = nothing yet). */
  shown?: string;
  /** Canvas pixel width it was drawn at. */
  width?: number;
  /** Strips to redraw to reach the latest fingerprint. */
  bands: Band[];
  /** Fingerprint of a render in flight; strips that arrive meanwhile go
   * on top of it. */
  drawing?: string;
  /** Bumps whenever the drawn content is thrown away, so a render in
   * flight does not mark a stale result as shown. */
  stamp: number;
};

/**
 * Draws pages into canvases on demand: visible pages first, one engine
 * render at a time so edits and hit tests never wait behind a burst of
 * renders, and only the changed strips of a page after an edit.
 */
export function createPageRenderer(options: {
  docKey: string;
  /** CSS pixels per point. */
  scale: () => number;
  onError?: (error: unknown) => void;
}) {
  const states = new Map<number, PageState>();
  let pages: PageInfo[] = [];
  let busy = false;
  let disposed = false;

  const state = (index: number): PageState => {
    let s = states.get(index);
    if (!s) {
      s = { visible: false, bands: [], stamp: 0 };
      states.set(index, s);
    }
    return s;
  };

  const dpr = () =>
    Math.min(
      MAX_DPR,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    );

  /** Canvas size in pixels for a page at the current zoom. */
  const pixelWidth = (page: PageInfo) =>
    Math.max(16, Math.round(page.width * options.scale() * dpr()));
  const pixelHeight = (page: PageInfo) =>
    Math.max(16, Math.round(page.height * options.scale() * dpr()));

  /** Whether a page needs a full redraw. */
  const stale = (index: number) => {
    const s = states.get(index);
    const page = pages[index];
    if (!s?.canvas || !page) return false;
    return s.shown === undefined || s.width !== pixelWidth(page);
  };

  function nextJob(): { index: number; band?: Band[] } | undefined {
    const candidates = [...states.entries()]
      .filter(([, s]) => s.visible && s.canvas)
      .map(([index]) => index)
      .sort((a, b) => a - b);
    for (const index of candidates) if (stale(index)) return { index };
    for (const index of candidates) {
      const s = states.get(index);
      if (s?.bands.length) return { index, band: s.bands };
    }
    return undefined;
  }

  async function draw(index: number, bands?: Band[]) {
    const s = state(index);
    const page = pages[index];
    const canvas = s.canvas;
    if (!page || !canvas) return;
    const width = pixelWidth(page);
    const target = page.fingerprint;
    const stamp = s.stamp;
    s.drawing = target;
    s.bands = [];
    try {
      if (!bands) {
        const out: Rendered = await renderPage(options.docKey, index, width);
        if (disposed || s.canvas !== canvas || s.stamp !== stamp)
          return out.bitmap.close();
        canvas.width = out.bitmap.width;
        canvas.height = out.bitmap.height;
        canvas.getContext('2d')?.drawImage(out.bitmap, 0, 0);
        out.bitmap.close();
        s.width = width;
      } else {
        // One strip covering every changed band of the page.
        const top = Math.min(...bands.map((b) => b.top));
        const bottom = Math.max(...bands.map((b) => b.bottom));
        const out = await renderBand(options.docKey, index, width, top, bottom);
        if (disposed || s.canvas !== canvas || s.stamp !== stamp)
          return out.bitmap.close();
        const perPoint = width / page.width;
        canvas
          .getContext('2d')
          ?.drawImage(out.bitmap, 0, Math.round(top * perPoint));
        out.bitmap.close();
      }
      // Strips that arrived meanwhile (in `s.bands`) take it the rest of
      // the way.
      s.shown = target;
    } finally {
      s.drawing = undefined;
    }
  }

  /** Throws away what a page shows, so it is drawn afresh. */
  function discard(s: PageState) {
    s.shown = undefined;
    s.bands = [];
    s.stamp++;
  }

  async function pump() {
    if (busy || disposed) return;
    const job = nextJob();
    if (!job) return;
    busy = true;
    try {
      await draw(job.index, job.band);
    } catch (error) {
      options.onError?.(error);
      const s = states.get(job.index);
      if (s) discard(s);
    } finally {
      busy = false;
    }
    void pump();
  }

  return {
    /** The size a page's canvas element should take (CSS pixels). */
    cssSize(page: PageInfo) {
      return {
        width: page.width * options.scale(),
        height: page.height * options.scale(),
      };
    },
    /** New page list (and the strips that changed since the last one). */
    update(next: PageInfo[], bands: Band[] = []) {
      const previous = pages;
      pages = next;
      for (const [index, s] of states) {
        const page = next[index];
        if (!page) {
          discard(s);
          continue;
        }
        const before = previous[index];
        // What the canvas shows, or will once the render in flight lands.
        const base = s.drawing ?? s.shown;
        if (base === undefined || page.fingerprint === base) continue;
        const sameSize =
          before &&
          before.width === page.width &&
          before.height === page.height;
        const strips = bands.filter((b) => b.page === index);
        if (sameSize && strips.length && base === before?.fingerprint) {
          s.bands.push(...strips);
        } else if (sameSize && strips.length && s.bands.length) {
          // Already behind by some strips: these go with them.
          s.bands.push(...strips);
        } else {
          discard(s);
        }
      }
      void pump();
    },
    /** Gives a page its canvas (or takes it away when it scrolls off). */
    attach(index: number, canvas: HTMLCanvasElement | undefined) {
      const s = state(index);
      s.canvas = canvas;
      if (!canvas) discard(s);
      void pump();
    },
    setVisible(index: number, visible: boolean) {
      state(index).visible = visible;
      if (visible) void pump();
    },
    /** Redraws everything (after a zoom change). */
    invalidate() {
      for (const s of states.values()) discard(s);
      void pump();
    },
    pixelWidth,
    pixelHeight,
    dispose() {
      disposed = true;
      states.clear();
    },
  };
}

export type PageRenderer = ReturnType<typeof createPageRenderer>;
