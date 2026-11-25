import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paneOf } from '../layoutManager';
import { canDuplicateSplit } from '../utils/canDuplicateSplit';
import { createRoutedSplitLayoutWithRouter } from './fixtures';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    type: 'mock-component',
    id,
    params,
  })),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

function createMockOrchestrator(): BlockOrchestrator {
  return {
    isBlockMounted: vi.fn(() => false),
    createBlockInstance: vi.fn((_type, id, _splitId) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
  } as unknown as BlockOrchestrator;
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** Whether the split header offers Duplicate split for the split at `url`. */
function offersDuplicate(url: string) {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;

    const { manager, router } = createRoutedSplitLayoutWithRouter(
      createMockOrchestrator(),
      url
    );
    const [split] = manager.splits();

    return canDuplicateSplit(router, paneOf(split!.id), split!.content);
  });
}

describe('Duplicate split', () => {
  it('duplicates a view showing its list', () => {
    expect(offersDuplicate('/mail')).toBe(true);
    expect(offersDuplicate('/channels')).toBe(true);
  });

  // A thread opens once per tab: a duplicate's Mail view would drop it and
  // show the list, so the split can't be duplicated while it shows one.
  it('does not duplicate a Mail split showing a thread', () => {
    expect(offersDuplicate('/mail/thread-1')).toBe(false);
  });
});
