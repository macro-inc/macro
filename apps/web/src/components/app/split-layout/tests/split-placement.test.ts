import { layoutShape } from '@app/lib/split-router/panes/layout-tree';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function setup(url: string) {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;

    return createRoutedSplitLayoutWithRouter(createMockOrchestrator(), url);
  });
}

describe('opening a split beside another', () => {
  it('splits only the active stacked split, leaving the split above full width', async () => {
    // Home over Channels, with Channels active.
    const { manager, router } = setup('/home/~/channels?layout=c2pp');
    const [above, active] = manager.splits();
    manager.activateSplit(active!.id);

    manager.openWithSplit(
      { type: 'component', id: 'home' },
      {
        preferNewSplit: true,
        allowDuplicate: true,
        beside: { split: active!.id, side: 'right' },
      }
    );
    await router.settled();

    expect(layoutShape(router.layout()!)).toEqual({
      axis: 'column',
      children: ['pane', { axis: 'row', children: ['pane', 'pane'] }],
    });
    expect(manager.splits().map((split) => split.id)).toEqual([
      above!.id,
      active!.id,
      expect.any(String),
    ]);
  });
});
