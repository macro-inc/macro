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
    // Opening: the overview comes first.
    const overview = queued.filter((q) => q.tile.scale < 0.9);
    expect(overview.length).toBe(16);
    expect(overview.every((q) => q.tile.priority === -1)).toBe(true);
    compositor.update(view);
    await finishAll();

    compositor.invalidate({ x: 10, y: 10, w: 50, h: 50 });
    const stale = queued.filter((q) => q.tile.scale < 0.9);
    const visible = queued.filter((q) => q.tile.scale > 0.9);
    // One overview tile changed; the view's tiles (the changed one and the
    // margin a settled view prefetches) all come before it.
    expect(stale.length).toBe(1);
    expect(visible.length).toBeGreaterThan(0);
    for (const v of visible) {
      expect(stale[0].tile.priority).toBeGreaterThan(v.tile.priority);
    }
    compositor.dispose();
  });
});
