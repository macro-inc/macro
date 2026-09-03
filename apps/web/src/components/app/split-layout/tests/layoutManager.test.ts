import type { ResizeZoneCtx } from '@core/component/Resize/types';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
} from '../layoutManager';
import { createMobileSwipeLayout } from '../mobile/createMobileSwipeLayout';
import { previewControllerWidthForContent } from '../previewController';

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
    rekeyBlockInstance: vi.fn(),
  } as unknown as BlockOrchestrator;
}

describe('layoutManager', () => {
  describe('swapSplit', () => {
    it('swaps adjacent splits and delegates the panel reorder to Resize', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'component', id: 'calendar' },
        ]);
        const [first, second] = manager.splits();
        const swap = vi.fn();
        manager.setResizeContext({
          canFit: () => true,
          swap,
        } as unknown as ResizeZoneCtx);

        manager.swapSplit(second!.id, 'left');

        expect(manager.splits().map((split) => split.id)).toEqual([
          second!.id,
          first!.id,
        ]);
        expect(swap).toHaveBeenCalledWith(second!.id, first!.id);

        dispose();
      });
    });

    it('swaps a preview pair as a unit', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'component', id: 'calendar' },
        ]);
        const controllerId = manager.splits()[0]!.id;
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;
        const calendarId = manager.splits()[2]!.id;

        manager.swapSplit(viewerId, 'right');

        expect(manager.splits().map((split) => split.id)).toEqual([
          calendarId,
          controllerId,
          viewerId,
        ]);
        expect(manager.canSwapSplit(viewerId, 'right')).toBe(false);
        expect(manager.canSwapSplit(viewerId, 'left')).toBe(true);

        dispose();
      });
    });
  });

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

    it('refreshes entry state when merging content already open in the target split', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          {
            type: 'md',
            id: 'doc-1',
            state: { retained: true, source: 'first' },
          },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1', state: { source: 'second' } },
          { handle: split, mergeHistory: true, referredFrom: null }
        );

        expect(split.history()).toHaveLength(1);
        expect(split.content().state).toEqual({
          retained: true,
          source: 'second',
        });

        split.replace({ next: { type: 'md', id: 'doc-2' } });
        split.goBack();
        expect(split.content().state).toEqual({
          retained: true,
          source: 'second',
        });

        dispose();
      });
    });

    it('jumps back to the nearest earlier entry matching a predicate', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;

        split.replace({ next: { type: 'md', id: 'doc-1' } });
        split.replace({ next: { type: 'component', id: 'tasks' } });
        split.replace({ next: { type: 'md', id: 'doc-2' } });
        split.replace({ next: { type: 'channel', id: 'ch-1' } });

        const moved = split.goBackTo(
          (content) => content.type === 'component' && content.id === 'tasks'
        );

        expect(moved).toBe(true);
        expect(split.content()).toMatchObject({
          type: 'component',
          id: 'tasks',
        });
        // The skipped entries stay ahead, so forward still reaches them.
        expect(split.canGoForward()).toBe(true);

        dispose();
      });
    });

    it('skips history entries another split already displays', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'md', id: 'doc-1' },
        ]);
        const [listSplitState, docSplitState] = manager.splits();
        const listSplit = manager.getSplit(listSplitState.id)!;
        const docSplit = manager.getSplit(docSplitState.id)!;

        // The list split walks through doc-1 — which the other split is
        // already showing — before landing on a channel.
        listSplit.replace({ next: { type: 'md', id: 'doc-1' } });
        listSplit.replace({ next: { type: 'channel', id: 'ch-1' } });

        const moved = listSplit.goBackTo(
          (content) => content.type === 'md' && content.id === 'doc-1'
        );

        // doc-1 is unmountable here, so nothing moves: the split keeps showing
        // the channel rather than stranding its history on an entry it never
        // mounted.
        expect(moved).toBe(false);
        expect(listSplit.content()).toMatchObject({
          type: 'channel',
          id: 'ch-1',
        });
        expect(docSplit.content()).toMatchObject({ type: 'md', id: 'doc-1' });

        dispose();
      });
    });

    it('leaves the split put when nothing earlier matches', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;

        split.replace({ next: { type: 'md', id: 'doc-1' } });

        const moved = split.goBackTo(
          (content) => content.type === 'component' && content.id === 'tasks'
        );

        expect(moved).toBe(false);
        expect(split.content()).toMatchObject({ type: 'md', id: 'doc-1' });

        dispose();
      });
    });
  });

  describe('component metadata', () => {
    it('updates the current mount through a retained split handle', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const handle = manager.getSplit(manager.splits()[0].id)!;
        const inboxMeta = handle.meta()!;

        handle.updateMeta?.({ splitPanelLayout: 'legacy' });
        handle.replace({ next: { type: 'component', id: 'tasks' } });

        const tasksMeta = handle.meta()!;
        expect(tasksMeta).not.toBe(inboxMeta);

        handle.updateMeta?.({ splitPanelLayout: 'composable' });

        expect(tasksMeta.splitPanelLayout).toBe('composable');
        expect(inboxMeta.splitPanelLayout).toBe('legacy');

        handle.replace({ next: { type: 'md', id: 'document-1' } });

        expect(handle.meta()).toBeUndefined();
        expect(handle.updateMeta).toBeUndefined();

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

  describe('adoptContentId', () => {
    it('moves the split onto the new id without remounting or pushing history', () => {
      createRoot((dispose) => {
        const orchestrator = createMockOrchestrator();
        const manager = createSplitLayout(orchestrator, [
          { type: 'agent', id: 'pending-1' },
        ]);
        const split = manager.splits()[0]!;
        const handle = manager.getSplit(split.id)!;
        const mountBefore = split.mount;
        const historyLengthBefore = handle.history().length;
        const mountsBefore = (
          orchestrator.createBlockInstance as ReturnType<typeof vi.fn>
        ).mock.calls.length;

        handle.adoptContentId({ type: 'agent', nextId: 'session-1' });

        const after = manager.splits()[0]!;
        expect(after.content).toEqual({ type: 'agent', id: 'session-1' });
        // The same block instance, re-labelled: nothing was mounted again.
        expect(after.mount.kind).toBe('block');
        expect(
          after.mount.kind === 'block' ? after.mount.handle : undefined
        ).toBe(mountBefore.kind === 'block' ? mountBefore.handle : null);
        expect(
          (orchestrator.createBlockInstance as ReturnType<typeof vi.fn>).mock
            .calls.length
        ).toBe(mountsBefore);
        expect(handle.history()).toHaveLength(historyLengthBefore);
        expect(handle.history().at(-1)).toEqual({
          type: 'agent',
          id: 'session-1',
        });
        expect(orchestrator.rekeyBlockInstance).toHaveBeenCalledWith(
          'agent',
          'pending-1',
          'session-1'
        );
        // `replace` is what the URL sync reads to swap the path in place
        // rather than adding a step back to a placeholder.
        expect(after.lastNavigationCause).toBe('replace');

        dispose();
      });
    });

    it('ignores a type that is not what the split is showing', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'agent', id: 'pending-1' },
        ]);
        const handle = manager.getSplit(manager.splits()[0]!.id)!;

        handle.adoptContentId({ type: 'md', nextId: 'session-1' });

        expect(manager.splits()[0]!.content).toEqual({
          type: 'agent',
          id: 'pending-1',
        });
        dispose();
      });
    });

    it('refuses an id another split already shows', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'agent', id: 'pending-1' },
          { type: 'agent', id: 'session-1' },
        ]);
        const handle = manager.getSplit(manager.splits()[0]!.id)!;

        handle.adoptContentId({ type: 'agent', nextId: 'session-1' });

        expect(manager.splits()[0]!.content).toEqual({
          type: 'agent',
          id: 'pending-1',
        });
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

  describe('preview mode', () => {
    const setup = () => {
      const manager = createSplitLayout(createMockOrchestrator(), [
        { type: 'component', id: 'inbox' },
      ]);
      const controllerId = manager.splits()[0].id;
      manager.activateSplit(controllerId);
      return { manager, controllerId };
    };

    it('eagerly opens an empty viewer right of the controller without activating it', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);

        expect(manager.previewControllerWidth(controllerId)).toBe(360);
        expect(manager.splits()).toHaveLength(2);
        const viewerId = manager.splits()[1].id;
        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.controllerOf(viewerId)).toBe(controllerId);
        expect(manager.getSplit(controllerId)?.isControllerSplit()).toBe(true);
        expect(manager.getSplit(controllerId)?.isViewerSplit()).toBe(false);
        expect(manager.getSplit(viewerId)?.isControllerSplit()).toBe(false);
        expect(manager.getSplit(viewerId)?.isViewerSplit()).toBe(true);
        expect(manager.previewPairs()).toEqual([{ controllerId, viewerId }]);
        expect(manager.splits()[1].content).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });
        expect(manager.events()).toMatchObject({
          type: SplitEvent.Insert,
          splitId: viewerId,
          activate: false,
        });
        expect(manager.activeSplitId()).toBe(controllerId);

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(2);
        expect(manager.splits()[1].content).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        dispose();
      });
    });

    it('resets the viewer to its placeholder without stacking history', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()[1].content).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        manager.getSplit(controllerId)?.resetPreview();

        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.splits()).toHaveLength(2);
        expect(manager.splits()[1].content).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });
        // Selection state was merge-replaced both ways, so the stale entity
        // does not linger as a back entry.
        expect(manager.getSplit(viewerId)?.canGoBack()).toBe(false);

        dispose();
      });
    });

    it('resets the viewer when the controller navigates backward or forward', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        const controller = manager.getSplit(controllerId)!;
        controller.replace({
          next: { type: 'component', id: 'channels' },
        });
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: controller }
        );
        controller.goBack();

        expect(controller.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });
        expect(manager.getSplit(viewerId)?.content()).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });

        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          { referredFrom: null, handle: controller }
        );
        controller.goForward();

        expect(controller.content()).toMatchObject({
          type: 'component',
          id: 'channels',
        });
        expect(manager.getSplit(viewerId)?.content()).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });
        expect(manager.viewerOf(controllerId)).toBe(viewerId);

        dispose();
      });
    });

    it('reset is a no-op without a viewer or when already on the placeholder', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();

        manager.resetPreviewMode(controllerId);
        expect(manager.splits()).toHaveLength(1);

        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;
        manager.resetPreviewMode(controllerId);

        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.splits()[1].content).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });

        dispose();
      });
    });

    it('uses the configured controller width for Email Soup', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'mail' },
        ]);
        const controllerId = manager.splits()[0].id;

        manager.engagePreviewMode(controllerId);

        expect(manager.previewControllerWidth(controllerId)).toBe(800);

        dispose();
      });
    });

    it('allows a Project block to control unless it is already a Viewer', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'project', id: 'project-controller' },
        ]);
        const controller = manager.getSplit(manager.splits()[0].id)!;

        expect(controller.canEngagePreview()).toBe(true);
        controller.engagePreview();

        const viewerId = controller.viewerId()!;
        const viewer = manager.getSplit(viewerId)!;
        manager.openWithSplit(
          { type: 'project', id: 'project-viewer' },
          { referredFrom: null, handle: controller }
        );

        expect(controller.content()).toMatchObject({
          type: 'project',
          id: 'project-controller',
        });
        expect(viewer.content()).toMatchObject({
          type: 'project',
          id: 'project-viewer',
        });
        expect(manager.viewerOf(controller.id)).toBe(viewer.id);
        expect(viewer.isViewerSplit()).toBe(true);
        expect(viewer.canEngagePreview()).toBe(false);

        viewer.engagePreview();
        expect(manager.previewPairs()).toEqual([
          { controllerId: controller.id, viewerId: viewer.id },
        ]);

        dispose();
      });
    });

    it('uses the configured Companies controller width', () => {
      createRoot((dispose) => {
        const content = { type: 'component' as const, id: 'companies' };
        const manager = createSplitLayout(createMockOrchestrator(), [content]);
        const controllerId = manager.splits()[0].id;

        manager.engagePreviewMode(controllerId);

        for (const viewportWidth of [1000, 1600]) {
          expect(
            manager.previewControllerWidth(controllerId, viewportWidth)
          ).toBe(previewControllerWidthForContent(content, viewportWidth));
        }

        dispose();
      });
    });

    it('creates a distinct empty viewer for each preview controller', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'component', id: 'channels' },
        ]);
        const [firstController, secondController] = manager.splits();

        manager.engagePreviewMode(firstController.id);
        const firstViewerId = manager.viewerOf(firstController.id)!;
        manager.engagePreviewMode(secondController.id);
        const secondViewerId = manager.viewerOf(secondController.id)!;

        expect(secondViewerId).toBeDefined();
        expect(secondViewerId).not.toBe(firstViewerId);
        expect(manager.splits().map((split) => split.id)).toEqual([
          firstController.id,
          firstViewerId,
          secondController.id,
          secondViewerId,
        ]);

        dispose();
      });
    });

    it('adopts an unclaimed adjacent placeholder split instead of duplicating it', () => {
      createRoot((dispose) => {
        // An existing unclaimed placeholder is adopted rather than duplicated,
        // leaving the placeholder (last initial split) active beforehand.
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'component', id: 'preview-empty' },
        ]);
        const controllerId = manager.splits()[0].id;
        const placeholderId = manager.splits()[1].id;
        expect(manager.activeSplitId()).toBe(placeholderId);

        manager.engagePreviewMode(controllerId);

        expect(manager.splits()).toHaveLength(2);
        expect(manager.viewerOf(controllerId)).toBe(placeholderId);
        // The controller takes over activation from its adopted viewer so
        // active-split-targeted navigations redirect through it.
        expect(manager.activeSplitId()).toBe(controllerId);

        dispose();
      });
    });

    it('restores a persisted Preview Pair onto existing adjacent splits', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'md', id: 'doc-1' },
        ]);
        const controllerId = manager.splits()[0].id;
        const viewerId = manager.splits()[1].id;

        expect(manager.restorePreviewPair(controllerId, viewerId)).toBe(true);
        expect(manager.splits()).toHaveLength(2);
        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.controllerOf(viewerId)).toBe(controllerId);
        expect(manager.previewControllerWidth(controllerId)).toBe(360);
        expect(manager.activeSplitId()).toBe(controllerId);

        dispose();
      });
    });

    it('rejects a persisted Preview Pair that is no longer adjacent', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
          { type: 'md', id: 'between' },
          { type: 'md', id: 'viewer' },
        ]);
        const controllerId = manager.splits()[0].id;
        const viewerId = manager.splits()[2].id;

        expect(manager.restorePreviewPair(controllerId, viewerId)).toBe(false);
        expect(manager.previewPairs()).toEqual([]);

        dispose();
      });
    });

    it('unlinks a Preview Pair when a split is inserted between it', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        const inserted = manager.createNewSplit({
          content: { type: 'md', id: 'between' },
          referredFrom: null,
          insertIndex: 1,
        });

        expect(manager.splits().map((split) => split.id)).toEqual([
          controllerId,
          inserted.id,
          viewerId,
        ]);
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.controllerOf(viewerId)).toBeUndefined();
        expect(manager.previewPairs()).toEqual([]);

        dispose();
      });
    });

    it('unlinks a Preview Pair when reconciliation separates it', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'viewer' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;
        const between = manager.createNewSplit({
          content: { type: 'md', id: 'between' },
          referredFrom: null,
        });

        manager.reconcile([
          { type: 'component', id: 'inbox' },
          { type: 'md', id: 'between' },
          { type: 'md', id: 'viewer' },
        ]);

        expect(manager.splits().map((split) => split.id)).toEqual([
          controllerId,
          between.id,
          viewerId,
        ]);
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.controllerOf(viewerId)).toBeUndefined();
        expect(manager.previewPairs()).toEqual([]);

        dispose();
      });
    });

    it('controller-originated navigation never grows the preview history', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;
        const viewer = manager.getSplit(viewerId)!;

        // Selections from the controller replace the preview's current entry.
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(2);
        expect(viewer.content()).toMatchObject({ type: 'md', id: 'doc-2' });
        expect(viewer.history()).toHaveLength(1);
        expect(viewer.canGoBack()).toBe(false);
        expect(manager.activeSplitId()).toBe(controllerId);

        // The preview's own navigation stacks up as usual...
        manager.openWithSplit(
          { type: 'md', id: 'doc-3' },
          { referredFrom: null, handle: manager.getSplit(viewerId) }
        );
        expect(viewer.history()).toHaveLength(2);

        // ...and back returns to the last controller selection.
        viewer.goBack();
        expect(viewer.content()).toMatchObject({ type: 'md', id: 'doc-2' });

        dispose();
      });
    });

    it('routes Controller replacements to the Viewer, honoring new-split intent', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        // A replacement from the Controller lands in the Viewer.
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(2);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });
        expect(manager.activeSplitId()).toBe(controllerId);

        // Explicit new-split intent opens a real new split; the Preview Pair
        // stays.
        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          {
            referredFrom: null,
            preferNewSplit: true,
            handle: manager.getSplit(controllerId),
          }
        );
        expect(manager.splits()).toHaveLength(3);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });
        expect(manager.viewerOf(controllerId)).toBe(viewerId);

        dispose();
      });
    });

    it('replacePreview dissolves the Preview Pair and opens in its place', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        // Something is being previewed...
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(2);

        // ...and opening another row for real takes the whole pair's place.
        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          {
            referredFrom: null,
            replacePreview: true,
            handle: manager.getSplit(controllerId),
          }
        );

        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(viewerId)).toBeUndefined();
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.getSplit(controllerId)!.isControllerSplit()).toBe(false);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-2',
        });
        expect(manager.activeSplitId()).toBe(controllerId);

        // The list it replaced is one step back.
        manager.getSplit(controllerId)!.goBack();
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });

        dispose();
      });
    });

    it('replacePreview wins over new-split intent even with room to spare', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          {
            referredFrom: null,
            replacePreview: true,
            preferNewSplit: true,
            handle: manager.getSplit(controllerId),
          }
        );

        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(viewerId)).toBeUndefined();
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        dispose();
      });
    });

    it('replacePreview promotes the previewed row itself without duplicating it', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );

        // The Viewer holds this content; closing it with the pair leaves the
        // Controller free to take it, rather than short-circuiting into the
        // split that is about to disappear.
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          {
            referredFrom: null,
            replacePreview: true,
            handle: manager.getSplit(controllerId),
          }
        );

        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(viewerId)).toBeUndefined();
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        dispose();
      });
    });

    it('promotes the previewed content into its own split, resetting the Viewer', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        // New-split intent for the row currently being previewed: the Viewer's
        // copy is that preview, so it must not short-circuit into "already
        // open" — the content gets a real split and the preview resets.
        const created = manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          {
            referredFrom: null,
            preferNewSplit: true,
            handle: manager.getSplit(controllerId),
          }
        );

        expect(manager.splits()).toHaveLength(3);
        expect(created?.id).not.toBe(viewerId);
        expect(created?.content()).toMatchObject({ type: 'md', id: 'doc-1' });
        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });

        dispose();
      });
    });

    it('leaves the preview in place when a promotion cannot fit', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        manager.setResizeContext({
          canFit: () => false,
        } as unknown as ResizeZoneCtx);

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          {
            referredFrom: null,
            preferNewSplit: true,
            handle: manager.getSplit(controllerId),
          }
        );

        expect(manager.splits()).toHaveLength(2);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });

        dispose();
      });
    });

    it('honors handle-less new-split intent without dissolving the Preview Pair', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        const newSplit = manager.openWithSplit(
          { type: 'component', id: 'inbox' },
          {
            referredFrom: 'hotkey',
            allowDuplicate: true,
            preferNewSplit: true,
          }
        );

        expect(manager.splits()).toHaveLength(3);
        expect(manager.viewerOf(controllerId)).toBe(viewerId);
        expect(manager.controllerOf(viewerId)).toBe(controllerId);
        expect(newSplit?.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });
        expect(manager.activeSplitId()).toBe(newSplit?.id);

        dispose();
      });
    });

    it('new-split intent falls back to the Viewer when the layout is full', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;
        manager.setResizeContext({
          canFit: () => false,
        } as unknown as ResizeZoneCtx);

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          {
            referredFrom: null,
            preferNewSplit: true,
            handle: manager.getSplit(controllerId),
          }
        );
        // The fallback replaces the Viewer — never the Controller.
        expect(manager.splits()).toHaveLength(2);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });

        dispose();
      });
    });

    it('external (handle-less) navigation dissolves the Preview Pair', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        expect(manager.splits()).toHaveLength(2);

        // Sidebar-style soup view: content replaces the controller, the
        // Viewer closes.
        manager.openWithSplit(
          { type: 'component', id: 'channels' },
          { referredFrom: null }
        );
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'component',
          id: 'channels',
        });
        expect(manager.viewerOf(controllerId)).toBeUndefined();

        // Command-menu-style entity selection dissolves the Preview Pair the
        // same way.
        manager.engagePreviewMode(controllerId);
        expect(manager.splits()).toHaveLength(2);
        manager.openWithSplit(
          { type: 'md', id: 'doc-k' },
          { referredFrom: null }
        );
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-k',
        });
        expect(manager.viewerOf(controllerId)).toBeUndefined();

        dispose();
      });
    });

    it('returns a duplicate split without activating it', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.createNewSplit({
          content: { type: 'md', id: 'doc-open-elsewhere' },
          referredFrom: null,
        });
        manager.activateSplit(controllerId);
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        const result = manager.openWithSplit(
          { type: 'md', id: 'doc-open-elsewhere' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );

        expect(manager.splits()).toHaveLength(3);
        expect(result?.content()).toMatchObject({
          type: 'md',
          id: 'doc-open-elsewhere',
        });
        expect(manager.activeSplitId()).toBe(controllerId);
        // The eager viewer keeps its placeholder; nothing was opened into it.
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'component',
          id: 'preview-empty',
        });

        dispose();
      });
    });

    it('disengages the Controller when the Viewer is closed', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;

        manager.removeSplit(viewerId);
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.previewPairs()).toEqual([]);

        // Subsequent navigation replaces the controller normally.
        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-2',
        });

        dispose();
      });
    });

    it('disengages when the Controller navigates away from a list view', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        expect(manager.splits()).toHaveLength(2);

        // The Viewer still shows the placeholder: it closes along with the
        // Preview Pair.
        manager.getSplit(controllerId)!.replace({
          next: { type: 'md', id: 'doc-x' },
        });
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.splits()).toHaveLength(1);

        dispose();
      });
    });

    it('closes a content-bearing viewer when the controller leaves its list view', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;

        manager.getSplit(controllerId)!.replace({
          next: { type: 'md', id: 'doc-x' },
        });
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(viewerId)).toBeUndefined();

        dispose();
      });
    });

    it('closes the viewer when the controller closes', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;

        manager.getSplit(controllerId)!.close();
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.previewPairs()).toEqual([]);
        expect(manager.getSplit(controllerId)).toBeUndefined();
        expect(manager.getSplit(viewerId)).toBeUndefined();
        expect(manager.splits()).toHaveLength(1);
        expect(manager.splits()[0].content).toMatchObject({
          type: 'component',
          id: 'inbox',
        });

        dispose();
      });
    });

    it('disengages when reconcile drops the viewer', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.viewerOf(controllerId)).toBeDefined();

        manager.reconcile([{ type: 'component', id: 'inbox' }]);

        expect(manager.splits()).toHaveLength(1);
        expect(manager.splits()[0].id).toBe(controllerId);
        expect(manager.viewerOf(controllerId)).toBeUndefined();

        dispose();
      });
    });

    it('disengage closes the viewer and restores normal replace behavior', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;

        manager.disengagePreviewMode(controllerId);
        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.previewControllerWidth(controllerId)).toBeUndefined();
        expect(manager.getSplit(viewerId)).toBeUndefined();

        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-2',
        });

        dispose();
      });
    });

    it('can unlink the Preview Pair without closing splits for URL reconstruction', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        const viewerId = manager.viewerOf(controllerId)!;

        manager.unlinkPreviewPair(controllerId);

        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.previewControllerWidth(controllerId)).toBeUndefined();
        expect(manager.getSplit(controllerId)).toBeDefined();
        expect(manager.getSplit(viewerId)).toBeDefined();

        dispose();
      });
    });

    it('leaves openWithSplit untouched when no split is engaged', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();

        manager.openWithSplit(
          { type: 'md', id: 'doc-1' },
          { referredFrom: null, handle: manager.getSplit(controllerId) }
        );
        expect(manager.splits()).toHaveLength(1);
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-1',
        });
        expect(manager.activeSplitId()).toBe(controllerId);

        dispose();
      });
    });

    it('the Viewer navigates like a normal split', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.engagePreviewMode(controllerId);
        const viewerId = manager.viewerOf(controllerId)!;

        // A replacement from the Viewer replaces the Viewer.
        manager.openWithSplit(
          { type: 'md', id: 'doc-2' },
          { referredFrom: null, handle: manager.getSplit(viewerId) }
        );
        expect(manager.splits()).toHaveLength(2);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-2',
        });
        expect(manager.viewerOf(controllerId)).toBe(viewerId);

        // New-split intent from the Viewer opens a real new split;
        // the Preview Pair stays intact and the Controller is untouched.
        manager.openWithSplit(
          { type: 'md', id: 'doc-3' },
          {
            referredFrom: null,
            preferNewSplit: true,
            handle: manager.getSplit(viewerId),
          }
        );
        expect(manager.splits()).toHaveLength(3);
        expect(manager.getSplit(viewerId)!.content()).toMatchObject({
          type: 'md',
          id: 'doc-2',
        });
        expect(manager.getSplit(controllerId)!.content()).toMatchObject({
          type: 'component',
          id: 'inbox',
        });
        expect(manager.viewerOf(controllerId)).toBe(viewerId);

        dispose();
      });
    });

    it('cannot engage without room for a Viewer', () => {
      createRoot((dispose) => {
        const { manager, controllerId } = setup();
        manager.setResizeContext({
          canFit: () => false,
        } as unknown as ResizeZoneCtx);

        expect(manager.canEngagePreview(controllerId)).toBe(false);
        manager.engagePreviewMode(controllerId);

        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.splits()).toHaveLength(1);

        dispose();
      });
    });

    it('cannot engage ineligible content as a preview controller', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'doc-1' },
        ]);
        const controllerId = manager.splits()[0].id;

        expect(manager.canEngagePreview(controllerId)).toBe(false);
        manager.engagePreviewMode(controllerId);

        expect(manager.viewerOf(controllerId)).toBeUndefined();
        expect(manager.splits()).toHaveLength(1);

        dispose();
      });
    });
  });

  describe('popover splits', () => {
    it('lets an onClose handler decide when a popover finishes closing', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), []);
        const onClose = vi.fn();
        const popover = manager.createPopoverSplit({
          content: { type: 'component', id: 'composer' },
          onClose,
        });

        popover.close();

        expect(onClose).toHaveBeenCalledOnce();
        expect(popover.isOpen()).toBe(true);

        const finishClose = onClose.mock.calls[0][0];
        finishClose();
        expect(popover.isOpen()).toBe(false);

        dispose();
      });
    });

    it('closes immediately when no onClose handler is provided', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), []);
        const popover = manager.createPopoverSplit({
          content: { type: 'component', id: 'composer' },
        });

        popover.close();

        expect(popover.isOpen()).toBe(false);
        dispose();
      });
    });
  });
});
