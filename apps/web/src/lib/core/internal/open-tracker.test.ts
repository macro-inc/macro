import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  trackOpen: vi.fn(),
  blockId: undefined as string | undefined,
}));
vi.mock('./track-open', () => ({ trackOpen: mocks.trackOpen }));
vi.mock('../block', () => ({ useMaybeBlockId: () => mocks.blockId }));
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

import { createOpenTracker } from './open-tracker';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  mocks.trackOpen.mockReset();
  mocks.blockId = undefined;
});

function track(initial: string | undefined) {
  const [item, setItem] = createSignal(initial);
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    createOpenTracker('initiative', item);
  });
  return setItem;
}

it('records an item once it has loaded, and each later open of an item', () => {
  const setItem = track(undefined);
  expect(mocks.trackOpen).not.toHaveBeenCalled();

  setItem('project-1');
  setItem('project-1');
  setItem('project-2');
  setItem('project-1');
  setItem(undefined);
  setItem('project-1');

  expect(mocks.trackOpen.mock.calls.map(([id]) => id)).toEqual([
    'project-1',
    'project-2',
    'project-1',
    'project-1',
  ]);
  expect(mocks.trackOpen).toHaveBeenCalledWith(
    'project-1',
    'initiative',
    expect.any(Function)
  );
});

it('records nothing inside a block, which BlockLoader records', () => {
  mocks.blockId = 'project-1';
  track('project-1');
  expect(mocks.trackOpen).not.toHaveBeenCalled();
});
