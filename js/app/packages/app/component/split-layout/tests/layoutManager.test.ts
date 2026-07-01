import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSplitLayout, type SplitContent } from '../layoutManager';

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

beforeAll(() => {
  // Mock window.matchMedia for tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

function createMockOrchestrator(): BlockOrchestrator {
  return {
    createBlockInstance: vi.fn((_type, id, _splitId) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
  } as unknown as BlockOrchestrator;
}

describe('layoutManager', () => {
  describe('reconciler', () => {
    it('should reconcile between current state and url changes', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'unified-list' },
          { type: 'md', id: 'test-md' },
          { type: 'component', id: 'unified-list' },
        ]);

        expect(manager.splits()).toHaveLength(3);

        const markdownSplitIdBefore = manager.splits()[1].id;

        manager.reconcile([
          { type: 'md', id: 'test-md' },
          { type: 'component', id: 'unified-list' },
          { type: 'component', id: 'unified-list' },
        ]);

        const markdownSplitIdAfter = manager.splits()[0].id;

        expect(manager.splits()).toHaveLength(3);
        expect(markdownSplitIdBefore).toBe(markdownSplitIdAfter);

        dispose();
      });
    });

    it('should reconcile between block -> component', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'test-md' },
        ]);

        manager.reconcile([{ type: 'component', id: 'unified-list' }]);

        expect(manager.splits()).toHaveLength(1);
        expect(manager.splits()[0].content.type).toBe('component');

        dispose();
      });
    });

    it('should preserve ordering when reconciling back to previous state (browser back)', () => {
      createRoot((dispose) => {
        const ORIGINAL_SPLITS = [
          { type: 'md', id: 'test-md-0' },
          { type: 'md', id: 'test-md-1' },
          { type: 'md', id: 'test-md-2' },
        ] satisfies SplitContent[];

        const NEW_SPLITS = [
          { type: 'md', id: 'test-md-0' },
          { type: 'md', id: 'test-md-3' },
          { type: 'md', id: 'test-md-2' },
        ] satisfies SplitContent[];

        const manager = createSplitLayout(
          createMockOrchestrator(),
          ORIGINAL_SPLITS
        );
        expect(manager.splits()).toHaveLength(3);
        expect(manager.splits().map((s) => s.content)).toEqual(ORIGINAL_SPLITS);

        manager.reconcile(NEW_SPLITS);
        expect(manager.splits()).toHaveLength(3);
        expect(manager.splits().map((s) => s.content)).toEqual(NEW_SPLITS);

        manager.reconcile(ORIGINAL_SPLITS);

        expect(manager.splits()).toHaveLength(3);
        expect(manager.splits().map((s) => s.content)).toEqual(ORIGINAL_SPLITS);

        dispose();
      });
    });
  });

  describe('entry state', () => {
    it('captures registered entry state and merges with existing state', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          {
            type: 'component',
            id: 'unified-list',
            state: { existing: true },
          },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.registerEntryStateCaptor('soup.listState', () => ({
          scrollOffset: 120,
          focus: 'entity-1',
        }));

        split.captureEntryState();

        expect(split.currentEntryState()).toEqual({
          existing: true,
          'soup.listState': {
            scrollOffset: 120,
            focus: 'entity-1',
          },
        });
        expect(split.history()[0].state).toEqual(split.currentEntryState());

        dispose();
      });
    });
  });

  describe('indexed insertion', () => {
    it('creates a split at the requested index', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'left' },
          { type: 'md', id: 'right' },
        ]);

        const inserted = manager.createNewSplit({
          content: { type: 'component', id: 'unified-list' },
          activate: true,
          referredFrom: null,
          insertIndex: 1,
        });

        expect(manager.splits().map((split) => split.content.id)).toEqual([
          'left',
          'unified-list',
          'right',
        ]);
        expect(manager.activeSplitId()).toBe(inserted.id);

        dispose();
      });
    });

    it('opens duplicate content at the requested index when duplicates are allowed', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'unified-list' },
          { type: 'md', id: 'current' },
        ]);

        const inserted = manager.openWithSplit(
          { type: 'component', id: 'unified-list' },
          {
            allowDuplicate: true,
            preferNewSplit: true,
            insertIndex: 1,
          }
        );

        expect(manager.splits().map((split) => split.content.id)).toEqual([
          'unified-list',
          'unified-list',
          'current',
        ]);
        expect(manager.activeSplitId()).toBe(inserted?.id);

        dispose();
      });
    });
  });
});
