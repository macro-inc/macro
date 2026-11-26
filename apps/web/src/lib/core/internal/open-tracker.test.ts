import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { BlockName } from '../block';

const mocks = vi.hoisted(() => ({
  trackOpen: vi.fn(),
  blockName: undefined as string | undefined,
  nested: false,
}));
vi.mock('./track-open', () => ({ trackOpen: mocks.trackOpen }));
vi.mock('../block', () => ({
  useMaybeBlockName: () => mocks.blockName,
  useIsNestedBlock: () => mocks.nested,
}));
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

import { createOpenTracker } from './open-tracker';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  mocks.trackOpen.mockReset();
  mocks.blockName = undefined;
  mocks.nested = false;
});

function track(
  initial: string | undefined,
  blockName: BlockName = 'initiative',
  options?: { ownBlock?: boolean }
) {
  const [item, setItem] = createSignal(initial);
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    createOpenTracker(blockName, item, options);
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
  mocks.blockName = 'initiative';
  track('project-1');
  expect(mocks.trackOpen).not.toHaveBeenCalled();
});

it("records an item's open in its own block when the view owns it", () => {
  mocks.blockName = 'contact';
  track('contact-1', 'contact', { ownBlock: true });
  expect(mocks.trackOpen).toHaveBeenCalledExactlyOnceWith(
    'contact-1',
    'contact',
    expect.any(Function)
  );
});

it("records nothing in another item's block or in an embed", () => {
  mocks.blockName = 'md';
  track('contact-1', 'contact', { ownBlock: true });
  dispose?.();

  mocks.blockName = 'contact';
  mocks.nested = true;
  track('contact-1', 'contact', { ownBlock: true });
  expect(mocks.trackOpen).not.toHaveBeenCalled();
});
