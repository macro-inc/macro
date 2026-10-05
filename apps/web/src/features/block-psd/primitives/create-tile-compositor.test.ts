import type {
  PendingTile,
  PsdEngine,
  TileRequest,
  TileResult,
} from '@core/psd-engine/client';
import { describe, expect, it } from 'vitest';
import { createTileCompositor, type TileSurface } from './create-tile-compositor';

/** An engine whose renders resolve when the test says so. */
function fakeEngine() {
  const queued: {
    id: number;
    tile: TileRequest;
    resolve: (r: TileResult | null) => void;
  }[] = [];
  const cancelled: number[] = [];
  let next = 1;
  const engine = {
    render(tile: TileRequest): PendingTile {
      const id = next++;
      const promise = new Promise<TileResult | null>((resolve) =>
        queued.push({ id, tile, resolve })
      );
      return { id, promise };
    },
    cancel(ids: number[]) {
      cancelled.push(...ids);
      for (const id of ids) {
        const at = queued.findIndex((q) => q.id === id);
        if (at >= 0) queued.splice(at, 1)[0].resolve(null);
      }
    },
  };
  const finishAll = async () => {
    for (const q of queued.splice(0)) {
      q.resolve({ bitmap: { close() {} } as ImageBitmap, millis: 1 });
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    engine: engine as Pick<PsdEngine, 'render' | 'cancel'>,
    queued,
    cancelled,
    finishAll,
  };
}

/** Surfaces that record what was drawn on them. */
function fakeSurfaces() {
  const draws: string[] = [];
  const createSurface = (width: number, height: number): TileSurface => ({
    width,
    height,
    getContext: () => ({
      clearRect: (x: number, y: number, w: number, h: number) =>
        draws.push(`clear ${x},${y} ${w}x${h}`),
      drawImage: ((_image: unknown, x: number, y: number) =>
        draws.push(`draw ${x},${y}`)) as CanvasRenderingContext2D['drawImage'],
    }),
  });
  return { draws, createSurface };
}

const doc = { width: 4096, height: 2048 };

describe('tile compositor', () => {
  it('composites the overview first, then the view at its level', async () => {
    const { engine, queued, finishAll } = fakeEngine();
    const { createSurface } = fakeSurfaces();
    const compositor = createTileCompositor({ engine, onTile: () => {}, createSurface });
    compositor.setDocument(doc);
    // A 4096 × 2048 canvas fits 2048 pixels at level 1: 4 × 2 tiles.
    expect(queued.map((q) => q.tile.level)).toEqual(Array(8).fill(1));
    expect(queued.every((q) => q.tile.priority === -1)).toBe(true);
    await finishAll();

    // 100% at 1×: level 0 tiles for a 1000 × 600 view at the top left.
    const view = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { w: 1000, h: 600 }, dpr: 1 };
    compositor.update(view);
    expect(queued.map((q) => `${q.tile.level}:${q.tile.x},${q.tile.y}`).sort()).toEqual(
      ['0:0,0', '0:512,0', '0:0,512', '0:512,512'].sort()
    );
    expect(compositor.isSharp(view)).toBe(false);
    await finishAll();
    expect(compositor.isSharp(view)).toBe(true);

    // 25% at 2×: level 1.
    compositor.update({ ...view, camera: { x: 0, y: 0, zoom: 0.25 }, dpr: 2 });
    expect(queued.length).toBe(0);
    compositor.dispose();
  });

  it('patches only the changed area of tiles in view', async () => {
    const { engine, queued, finishAll } = fakeEngine();
    const { draws, createSurface } = fakeSurfaces();
    const compositor = createTileCompositor({ engine, onTile: () => {}, createSurface });
    compositor.setDocument(doc);
    const view = { camera: { x: 0, y: 0, zoom: 1 }, viewport: { w: 500, h: 500 }, dpr: 1 };
    compositor.update(view);
    await finishAll();
    draws.length = 0;

    compositor.invalidate({ x: 10, y: 20, w: 30, h: 40 });
    // At once: just the stroke's pixels of the tile in view.
    expect(queued.map((q) => q.tile)).toEqual([
      { x: 10, y: 20, level: 0, width: 30, height: 40, priority: -2 },
    ]);
    await finishAll();
    expect(draws).toEqual(['clear 10,20 30x40', 'draw 10,20']);
    expect(compositor.isSharp(view)).toBe(true);

    // Once edits pause, the overview tile it touched (at level 1).
    await new Promise((r) => setTimeout(r, 400));
    const later = queued.filter((q) => q.tile.level === 1);
    expect(later).toHaveLength(1);
    expect(later[0].tile.priority).toBe(Number.MAX_SAFE_INTEGER);
    compositor.dispose();
  });

  it('cancels renders the view no longer needs', async () => {
    const { engine, cancelled, finishAll } = fakeEngine();
    const compositor = createTileCompositor({
      engine,
      onTile: () => {},
      createSurface: fakeSurfaces().createSurface,
    });
    compositor.setDocument(doc);
    await finishAll();
    compositor.update({ camera: { x: 0, y: 0, zoom: 1 }, viewport: { w: 400, h: 400 }, dpr: 1 });
    compositor.update({ camera: { x: 3000, y: 1500, zoom: 1 }, viewport: { w: 400, h: 400 }, dpr: 1 });
    expect(cancelled.length).toBeGreaterThan(0);
    compositor.dispose();
  });

  it('draws each cell from one source, scaled', async () => {
    const { engine, finishAll } = fakeEngine();
    const compositor = createTileCompositor({
      engine,
      onTile: () => {},
      createSurface: fakeSurfaces().createSurface,
    });
    compositor.setDocument({ width: 1024, height: 512 });
    await finishAll();
    // Only the overview (level 0 here: the canvas fits) is in.
    const calls: number[][] = [];
    const ctx = {
      canvas: { width: 800, height: 400 },
      clearRect() {},
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillRect() {},
      drawImage: (_s: unknown, ...args: number[]) => calls.push(args),
    } as unknown as CanvasRenderingContext2D;
    compositor.draw(ctx, {
      camera: { x: 0, y: 0, zoom: 0.5 },
      viewport: { w: 800, h: 400 },
      dpr: 1,
    });
    // Level 1 cell (0, 0) drawn from its two level-0 children.
    expect(calls).toEqual([
      [0, 0, 512, 512, 0, 0, 256, 256],
      [0, 0, 512, 512, 256, 0, 256, 256],
    ]);
    compositor.dispose();
  });
});
