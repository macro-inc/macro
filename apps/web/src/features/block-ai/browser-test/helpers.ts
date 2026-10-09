/**
 * What the Illustrator browser tests share: opening the fixture, reading
 * the canvas back, mapping canvas points to the page, and asking the
 * engine about the document.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** The sample's artboard (`sample-document.ts`). */
export const POSTER = { x: 0, y: 0, w: 800, h: 600 };

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Opens the fixture (`query` as in `fixture.tsx`) once it has drawn. */
export async function open(page: Page, query = '?sample') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('ai-editor')).toBeVisible();
  await expect.poll(() => inkedFraction(canvasOf(page))).toBeGreaterThan(0.02);
}

/** The canvas of the page, or of a person's editor. */
export const canvasOf = (scope: Page | Locator) =>
  scope.getByTestId('ai-canvas');

/** A pixel of the tile canvas at a page position (RGB). */
export function pixelAt(canvas: Locator, at: { x: number; y: number }) {
  return canvas
    .locator('canvas')
    .first()
    .evaluate(
      (node, p) => {
        const c = node as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        const k = c.width / r.width;
        const d = c
          .getContext('2d')
          ?.getImageData(
            Math.floor((p.x - r.left) * k),
            Math.floor((p.y - r.top) * k),
            1,
            1
          ).data;
        return d ? [d[0], d[1], d[2]] : [0, 0, 0];
      },
      { x: at.x, y: at.y }
    );
}

/** Share of tile-canvas pixels that differ from its corner (0 = blank). */
export function inkedFraction(canvas: Locator): Promise<number> {
  return canvas
    .locator('canvas')
    .first()
    .evaluate((node) => {
      const c = node as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (!ctx || c.width < 2) return 0;
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const [r, g, b] = [data[0], data[1], data[2]];
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        const d =
          Math.abs(data[i] - r) +
          Math.abs(data[i + 1] - g) +
          Math.abs(data[i + 2] - b);
        if (d > 40) inked++;
      }
      return inked / (data.length / 4);
    });
}

/**
 * Maps canvas points to the page for an artboard fitted in the window, as
 * opening and ⌘0 fit it (`core/view.ts`: the toolbar's 64 px on the left,
 * 16 px above, the status bar's 52 px below, and a 32 px margin).
 */
export async function fitted(canvas: Locator, artboard = POSTER) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  const freeW = box.width - 64;
  const freeH = box.height - 16 - 52;
  const zoom = Math.min((freeW - 64) / artboard.w, (freeH - 64) / artboard.h);
  const cx = box.x + 64 + freeW / 2;
  const cy = box.y + 16 + freeH / 2;
  return {
    zoom,
    at: (p: CanvasPoint) => ({
      x: cx + (p.x - (artboard.x + artboard.w / 2)) * zoom,
      y: cy + (p.y - (artboard.y + artboard.h / 2)) * zoom,
    }),
  };
}

/** Drags between two page positions in steps. */
export async function dragOn(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** The layers panel's rows, as the engine lists them. */
export function engineRows(page: Page, who?: number) {
  return page.evaluate(async (index) => {
    const engine =
      index === undefined
        ? window.aiFixture.engine()
        : window.aiFixture.collab?.people()[index]?.engine();
    return engine ? await engine.rows() : [];
  }, who);
}

/**
 * The object at a canvas point (the engine's hit test, into groups): its
 * id, kind, name, and canvas bounds rounded to 0.1 pt.
 */
export function objectAt(page: Page, p: CanvasPoint, who?: number) {
  return page.evaluate(
    async ([point, index]) => {
      const engine =
        index === undefined
          ? window.aiFixture.engine()
          : window.aiFixture.collab?.people()[index]?.engine();
      if (!engine) return null;
      const id = await engine.hitTest(point.x, point.y, 1, true);
      const info = id === null ? null : await engine.info(id);
      if (!info) return null;
      const r = (v: number) => Math.round(v * 10) / 10;
      const b = info.bounds;
      return {
        id: info.id,
        kind: info.kind,
        name: info.name,
        bounds: b
          ? { x0: r(b.x0), y0: r(b.y0), x1: r(b.x1), y1: r(b.y1) }
          : null,
        fill: info.fill,
        stroke: info.stroke,
        text: info.text?.text ?? null,
        hidden: info.hidden,
        locked: info.locked,
      };
    },
    [p, who] as const
  );
}

/** A node's properties by id. */
export function infoOf(page: Page, id: number, who?: number) {
  return page.evaluate(
    async ([node, index]) => {
      const engine =
        index === undefined
          ? window.aiFixture.engine()
          : window.aiFixture.collab?.people()[index]?.engine();
      return engine ? await engine.info(node) : null;
    },
    [id, who] as const
  );
}

/** Ids of the rows the layers panel shows as selected. */
export async function selectedRows(page: Page | Locator) {
  return page
    .locator('[data-testid="ai-layer-row"][aria-selected="true"]')
    .evaluateAll((rows) => rows.map((r) => r.textContent?.trim() ?? ''));
}

/** ⌘ on a Mac, Ctrl elsewhere (the fixture's browser runs on Linux). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
