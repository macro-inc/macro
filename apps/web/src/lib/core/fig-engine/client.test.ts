import { afterEach, expect, it, vi } from 'vitest';
import { FigEngine } from './client';
import type { FigRequest, FigResponse } from './protocol';

vi.mock('./compiled-module', () => ({
  compiledFigModule: async () => ({}),
}));

const workers: FakeWorker[] = [];
class FakeWorker extends EventTarget {
  requests: FigRequest[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    workers.push(this);
  }
  postMessage(request: FigRequest) {
    this.requests.push(request);
    if (request.kind === 'open' && workers[0] === this)
      queueMicrotask(() =>
        this.reply({
          id: request.id,
          ok: true,
          kind: 'open',
          summary: {
            rootId: '0:0',
            fileName: null,
            version: 1,
            nodeCount: 1,
            pages: [],
          },
        })
      );
  }
  reply(response: FigResponse) {
    this.dispatchEvent(new MessageEvent('message', { data: response }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  workers.length = 0;
});

it('keeps pointer queries independent of raster helpers that are still opening', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const engine = await FigEngine.open(new ArrayBuffer(0), { helpers: 1 });
  try {
    const [primary, helper] = workers;
    const tile = engine.render({
      page: 0,
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      scale: 1,
      outline: false,
      priority: -1,
    });
    expect(helper.requests.map((r) => r.kind)).toEqual(['open', 'render']);
    const hit = engine.hitTest(0, 10, 10, 1);
    const query = primary.requests.at(-1)!;
    expect(query.kind).toBe('query');
    primary.reply({ id: query.id, ok: true, kind: 'query', json: '[]' });
    await expect(hit).resolves.toEqual([]);
    engine.cancel([tile.id]);
    expect(helper.requests.at(-1)).toMatchObject({
      kind: 'cancel',
      ids: [tile.id],
    });
    helper.reply({ id: tile.id, ok: true, kind: 'cancelled' });
    await expect(tile.promise).resolves.toBeNull();
  } finally {
    engine.close();
  }
});
