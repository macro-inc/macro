import { computePosition } from '@floating-ui/dom';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { floatWithElement } from './floatWithElement';

vi.mock('@core/block', () => ({ isInBlock: () => false }));
vi.mock('@core/signal/blockElement', () => ({ blockElementSignal: {} }));
vi.mock('@floating-ui/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@floating-ui/dom')>()),
  computePosition: vi.fn(),
  autoUpdate: (
    _reference: Element,
    _floating: HTMLElement,
    update: () => void
  ) => {
    update();
    return () => {};
  },
}));

it('keeps an anchored picker hidden until its first position is ready', async () => {
  let resolve!: (position: Awaited<ReturnType<typeof computePosition>>) => void;
  vi.mocked(computePosition).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const floating = document.createElement('div');
  const anchor = document.createElement('button');
  let dispose!: () => void;
  createRoot((cleanup) => {
    dispose = cleanup;
    floatWithElement(floating, () => ({ element: () => anchor }));
  });
  try {
    expect(floating.style.visibility).toBe('hidden');
    resolve({
      x: 120,
      y: 240,
      placement: 'bottom-start',
      strategy: 'absolute',
      middlewareData: {},
    });
    await vi.waitFor(() => expect(floating.style.visibility).toBe('visible'));
    expect(floating.style.left).toBe('120px');
    expect(floating.style.top).toBe('240px');
  } finally {
    dispose();
  }
});
