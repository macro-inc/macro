import type {
  FigEngine,
  PendingTile,
  TileRequest,
  TileResult,
} from '@core/fig-engine/client';
import { describe, expect, it } from 'vitest';
import { createTileCompositor } from './create-tile-compositor';

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
    },
  };
  const finishAll = async () => {
    for (const q of queued.splice(0)) {
      q.resolve({ bitmap: { close() {} } as ImageBitmap, millis: 1 });
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { engine: engine as unknown as FigEngine, queued, finishAll };
}

describe('tile compositor', () => {
  it('coalesces interactive edits and retains a complete frame until sharp tiles are ready', async () => {
    const { engine, queued, finishAll } = fakeEngine();
    const compositor = createTileCompositor({ engine, onTile: () => {} });
    const view = {
      camera: { x: 0, y: 0, zoom: 1 },
      viewport: { w: 1200, h: 900 },
      dpr: 2,
    };
    const content = { x: 0, y: 0, w: 1200, h: 900 };
    compositor.setPage({
      page: 0,
      outline: false,
      content,
      background: '#fff',
    });
    compositor.update(view);
    await finishAll();
    compositor.beginInteractive();
    expect(queued).toHaveLength(1);
    expect(queued[0].tile.width).toBe(512);
    expect(queued[0].tile.height).toBe(384);
    for (let i = 0; i < 20; i++) compositor.invalidate(content);
    // Pointer updates never build a queue of stale frames or sharp tiles.
    expect(queued).toHaveLength(1);
    await finishAll();
    expect(queued).toHaveLength(1);
    await finishAll();
    const painted: unknown[][] = [];
    const ctx = {
      canvas: { width: 2400, height: 1800 },
      fillRect() {},
      drawImage(...args: unknown[]) {
        painted.push(args);
      },
    } as unknown as CanvasRenderingContext2D;
    compositor.draw(ctx, view);
    expect(painted).toHaveLength(1);
    expect(painted[0].slice(1)).toEqual([0, 0, 2400, 1800]);
    compositor.endInteractive();
    painted.length = 0;
    compositor.draw(ctx, view);
    expect(painted).toHaveLength(1);
    await finishAll();
    painted.length = 0;
    compositor.draw(ctx, view);
    expect(painted.length).toBeGreaterThan(1);
    compositor.dispose();
  });

  it('reports readiness only after painting content, including empty pages', async () => {
    const { engine, finishAll } = fakeEngine();
    const compositor = createTileCompositor({ engine, onTile: () => {} });
    const view = {
      camera: { x: 0, y: 0, zoom: 1 },
      viewport: { w: 512, h: 512 },
      dpr: 1,
    };
    const ctx = {
      canvas: { width: 512, height: 512 },
      fillRect() {},
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    expect(compositor.draw(ctx, view)).toBe(false);
    compositor.setPage({
      page: 0,
      outline: false,
      content: { x: 0, y: 0, w: 512, h: 512 },
      background: '#fff',
    });
    compositor.update(view);
    expect(compositor.draw(ctx, view)).toBe(false);
    await finishAll();
    expect(compositor.draw(ctx, view)).toBe(true);
    compositor.setPage({
      page: 1,
      outline: false,
      content: undefined,
      background: '#fff',
    });
    expect(compositor.draw(ctx, view)).toBe(true);
    compositor.dispose();
  });

  it('re-renders the overview after the view when an edit changes it', async () => {
    const { engine, queued, finishAll } = fakeEngine();
    const compositor = createTileCompositor({ engine, onTile: () => {} });
    const view = {
      camera: { x: 0, y: 0, zoom: 1 },
      viewport: { w: 1024, h: 1024 },
      dpr: 1,
    };
    compositor.setPage({
      page: 0,
      outline: false,
      content: { x: 0, y: 0, w: 4096, h: 4096 },
      background: '#fff',
    });
    // Opening: one coarse tile comes first, not sixteen detailed ones.
    const overview = queued.filter((q) => q.tile.scale < 0.9);
    expect(overview.length).toBe(1);
    expect(overview.every((q) => q.tile.priority === -1)).toBe(true);
    compositor.update(view);
    await finishAll();
    // Once settled, the detailed overview is queued behind the view.
    await new Promise((r) => setTimeout(r, 150));
    expect(queued.filter((q) => q.tile.scale === 0.5)).toHaveLength(16);
    expect(
      queued
        .filter((q) => q.tile.scale === 0.5)
        .every((q) => q.tile.priority === Number.MAX_SAFE_INTEGER)
    ).toBe(true);
    await finishAll();

    compositor.invalidate({ x: 10, y: 10, w: 50, h: 50 });
    // At once, only the changed tile in view (a drag's every step).
    expect(queued.map((q) => q.tile.scale)).toEqual([1]);
    await new Promise((r) => setTimeout(r, 400));
    const stale = queued.filter((q) => q.tile.scale < 0.9);
    const visible = queued.filter((q) => q.tile.scale > 0.9);
    // Once edits pause, the one overview tile that changed, after the view's
    // tiles (the changed one and the margin a settled view prefetches).
    expect(stale.length).toBe(1);
    expect(visible.length).toBeGreaterThan(0);
    for (const v of visible) {
      expect(stale[0].tile.priority).toBeGreaterThan(v.tile.priority);
    }
    compositor.dispose();
  });
});
