import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
} from '../layoutManager';
import { createMobileSwipeLayout } from '../mobile/createMobileSwipeLayout';

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

  describe('split history', () => {
    it('marks mergeHistory content changes as replace navigation', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;

        split.replace({
          next: { type: 'md', id: 'created-doc' },
          mergeHistory: true,
        });

        expect(manager.events()).toMatchObject({
          type: SplitEvent.ContentChange,
          cause: 'replace',
          newContent: { type: 'md', id: 'created-doc' },
          previousContent: { type: 'component', id: 'inbox' },
        });

        dispose();
      });
    });
  });

  describe('navigation params', () => {
    const channelWithTarget = {
      type: 'channel',
      id: 'ch-1',
      params: { channel_message_id: 'm-1' },
    } satisfies SplitContent;

    it('delivers one-shot params on same-split forward navigation', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.replace({ next: channelWithTarget });

        expect(split.content()).toMatchObject(channelWithTarget);

        dispose();
      });
    });

    it('delivers one-shot params on mergeHistory navigation', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.replace({ next: channelWithTarget, mergeHistory: true });

        expect(split.content()).toMatchObject(channelWithTarget);

        dispose();
      });
    });

    it('strips params when re-visiting an entry via history back/forward', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.replace({ next: channelWithTarget });

        split.goBack();
        expect(split.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });

        split.goForward();
        expect(split.content().type).toBe('channel');
        expect(split.content().params).toBeUndefined();

        dispose();
      });
    });

    it('strips params when removeFromHistory reattaches a prior entry', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.replace({ next: channelWithTarget });
        split.replace({ next: { type: 'md', id: 'doc-1' } });

        split.removeFromHistory((content) => content.type === 'md');

        expect(split.content().type).toBe('channel');
        expect(split.content().params).toBeUndefined();

        dispose();
      });
    });

    it('keeps params on history navigation when preserveParams is set', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);

        const split = manager.getSplit(manager.splits()[0].id)!;
        split.replace({
          next: { ...channelWithTarget, preserveParams: true },
        });

        split.goBack();
        split.goForward();

        expect(split.content()).toMatchObject(channelWithTarget);

        dispose();
      });
    });
  });

  describe('replaceAllSplits', () => {
    it('keeps the first split that already contains the target content', () => {
      createRoot((dispose) => {
        const target = {
          type: 'component',
          id: 'documents',
        } satisfies SplitContent;
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          target,
          { type: 'component', id: 'documents' },
          { type: 'md', id: 'right' },
        ]);

        const keptSplitId = manager.splits()[1].id;
        const keptSplit = manager.getSplit(keptSplitId)!;
        const historyBefore = keptSplit.history();
        const handle = manager.replaceAllSplits(target, {
          referredFrom: 'sidebar',
        });

        expect(manager.splits()).toHaveLength(1);
        expect(manager.splits()[0].id).toBe(keptSplitId);
        expect(manager.splits()[0].content).toEqual(target);
        expect(manager.activeSplitId()).toBe(handle.id);
        expect(handle.history()).toEqual(historyBefore);

        dispose();
      });
    });

    it('keeps the 0th split and replaces it when the target content is not open', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'md', id: 'right' },
        ]);
        const keptSplitId = manager.splits()[0].id;
        manager.spotlightSplit(manager.splits()[1].id);

        const target = {
          type: 'component',
          id: 'documents',
        } satisfies SplitContent;
        const handle = manager.replaceAllSplits(target, {
          referredFrom: 'sidebar',
        });

        expect(manager.splits()).toHaveLength(1);
        expect(manager.splits()[0].id).toBe(keptSplitId);
        expect(manager.splits()[0].content).toEqual(target);
        expect(manager.activeSplitId()).toBe(handle.id);
        expect(handle.isSpotLight()).toBe(false);
        expect(handle.previousContent()).toEqual({
          type: 'component',
          id: 'inbox',
        });

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

  describe('activation invariant', () => {
    it('refuses to activate an excluded split', () => {
      createRoot((dispose) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'foreground' },
          { type: 'md', id: 'background' },
        ]);

        const [fg, bg] = manager.splits();
        manager.activateSplit(fg.id);
        manager.setExclusionFilter((split) => split.id === bg.id);

        manager.activateSplit(bg.id);
        expect(manager.activeSplitId()).toBe(fg.id);

        manager.setExclusionFilter(undefined);
        manager.activateSplit(bg.id);
        expect(manager.activeSplitId()).toBe(bg.id);

        warn.mockRestore();
        dispose();
      });
    });

    it('keeps the promoted split active through mobile forward navigation and swipe back', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'list' },
        ]);
        const originalId = manager.splits()[0].id;
        manager.activateSplit(originalId);

        const swipeLayout = createMobileSwipeLayout(manager);

        // Forward navigation goes through the interceptor; with no animation
        // trigger registered it completes synchronously.
        manager.openWithSplit(
          { type: 'md', id: 'detail' },
          { referredFrom: null }
        );

        const detailId = swipeLayout.fgIsSlotA()
          ? swipeLayout.slotASplitId()
          : swipeLayout.slotBSplitId();
        expect(detailId).toBeDefined();
        expect(detailId).not.toBe(originalId);
        expect(manager.activeSplitId()).toBe(detailId);

        swipeLayout.swipeBack();
        expect(manager.activeSplitId()).toBe(originalId);

        dispose();
      });
    });
  });
});
