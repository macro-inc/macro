import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { keepSinglePane } from '../single-pane';
import { createRoutedSplitLayout } from './fixtures';

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

async function openBesideHome(singlePane: boolean) {
  return createRoot(async (dispose) => {
    const manager = createRoutedSplitLayout(createMockOrchestrator(), '/home', {
      singlePane: () => singlePane,
    });
    manager.openWithSplit(
      { type: 'component', id: 'channels' },
      { preferNewSplit: true }
    );
    await vi.waitFor(() =>
      expect(manager.activeSplit()?.content().id).toBe('channels')
    );
    const panes = manager.splits().map((split) => split.content.id);
    dispose();
    return panes;
  });
}

describe('single-pane browsing', () => {
  it('opens a new pane for an account', async () => {
    expect(await openBesideHome(false)).toEqual(['home', 'channels']);
  });

  it('replaces the one pane a caller with no account browses', async () => {
    expect(await openBesideHome(true)).toEqual(['channels']);
  });

  it('keeps one pane of a linked URL that holds several', async () => {
    const panes = await createRoot(async (dispose) => {
      const manager = createRoutedSplitLayout(
        createMockOrchestrator(),
        '/home/~/channels',
        { singlePane: () => true }
      );
      keepSinglePane(manager, () => true);
      await vi.waitFor(() => expect(manager.splits()).toHaveLength(1));
      const ids = manager.splits().map((split) => split.content.id);
      dispose();
      return ids;
    });
    expect(panes).toEqual(['channels']);
  });

  it("leaves an account's panes alone", async () => {
    const panes = await createRoot(async (dispose) => {
      const manager = createRoutedSplitLayout(
        createMockOrchestrator(),
        '/home/~/channels'
      );
      keepSinglePane(manager, () => false);
      await Promise.resolve();
      const ids = manager.splits().map((split) => split.content.id);
      dispose();
      return ids;
    });
    expect(panes).toEqual(['home', 'channels']);
  });
});
