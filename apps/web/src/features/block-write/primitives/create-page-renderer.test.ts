import type { Band, PageInfo } from '@core/docx-engine/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = {
  kind: 'page' | 'band';
  resolve: () => void;
};
const calls: Call[] = [];

function bitmap() {
  return { width: 10, height: 10, close: () => {} };
}

vi.mock('@core/docx-engine/client', () => ({
  renderPage: () =>
    new Promise((resolve) => {
      calls.push({
        kind: 'page',
        resolve: () => resolve({ bitmap: bitmap() }),
      });
    }),
  renderBand: () =>
    new Promise((resolve) => {
      calls.push({
        kind: 'band',
        resolve: () => resolve({ bitmap: bitmap() }),
      });
    }),
}));

const { createPageRenderer } = await import('./create-page-renderer');

const page = (fingerprint: string) =>
  ({ width: 600, height: 800, fingerprint }) as PageInfo;
const band = (top: number): Band => ({ page: 0, top, bottom: top + 10 });

function canvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => {} }),
  } as unknown as HTMLCanvasElement;
}

/** Lets the renderer's promise chain run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPageRenderer', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('draws strips that arrive while a strip render is in flight', async () => {
    const renderer = createPageRenderer({ docKey: 'd', scale: () => 1 });
    renderer.update([page('a')]);
    renderer.attach(0, canvas());
    renderer.setVisible(0, true);
    calls.shift()?.resolve();
    await settle();

    renderer.update([page('b')], [band(0)]);
    expect(calls.map((c) => c.kind)).toEqual(['band']);
    // Typing goes on while that strip is drawn.
    renderer.update([page('c')], [band(20)]);
    calls.shift()?.resolve();
    await settle();
    // The later strip is drawn next, not dropped.
    expect(calls.map((c) => c.kind)).toEqual(['band']);
    calls.shift()?.resolve();
    await settle();
    expect(calls).toEqual([]);
  });

  it('redraws when the page is invalidated during a render', async () => {
    const renderer = createPageRenderer({ docKey: 'd', scale: () => 1 });
    renderer.update([page('a')]);
    renderer.attach(0, canvas());
    renderer.setVisible(0, true);
    renderer.invalidate();
    calls.shift()?.resolve();
    await settle();
    // The first render is stale, so the page is drawn again.
    expect(calls.map((c) => c.kind)).toEqual(['page']);
    calls.shift()?.resolve();
    await settle();
    expect(calls).toEqual([]);
  });

  it('redraws a page that changed size while it was being drawn', async () => {
    const renderer = createPageRenderer({ docKey: 'd', scale: () => 1 });
    renderer.update([page('a')]);
    renderer.attach(0, canvas());
    renderer.setVisible(0, true);
    renderer.update([{ ...page('b'), height: 900 }]);
    calls.shift()?.resolve();
    await settle();
    expect(calls.map((c) => c.kind)).toEqual(['page']);
  });
});
