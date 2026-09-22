import { agentsRouteId } from '@app/features/agents-view/core/route';
import {
  getListNavigationSource,
  listNavigationSourceId,
  registerListNavigationSource,
  withListNavigationSource,
} from '@app/features/soup/collection/list-navigation-source';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { toast } from '@core/component/Toast/Toast';
import { createContentInstanceRegistry } from '@core/contentInstanceRegistry';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
} from '../layoutManager';
import { shouldShowSplitCloseButton } from '../layoutUtils';
import { createMobileSwipeLayout } from '../mobile/createMobileSwipeLayout';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: vi.fn() },
}));

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
    contentInstances: createContentInstanceRegistry(),
    isBlockMounted: vi.fn(() => false),
    createBlockInstance: vi.fn((_type, id, _splitId) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
    rekeyBlockInstance: vi.fn(),
  } as unknown as BlockOrchestrator;
}

describe('layoutManager', () => {
  it.each([true, false, undefined])(
    'honors activate=%s when direct split creation finds an existing entity',
    (activate) => {
      createRoot((dispose) => {
        const content = { type: 'email', id: 'already-open' } as const;
        const manager = createSplitLayout(createMockOrchestrator(), [
          content,
          { type: 'component', id: 'inbox' },
        ]);
        const [existing, other] = manager.splits();
        manager.activateSplit(other.id);
        vi.mocked(toast.alert).mockClear();

        const result = manager.createNewSplit({
          content,
          activate,
          allowDuplicate: true,
          referredFrom: 'sidebar',
        });

        expect(result?.id).toBe(existing.id);
        expect(manager.splits()).toHaveLength(2);
        expect(manager.activeSplitId()).toBe(activate ? existing.id : other.id);
        expect(toast.alert).toHaveBeenCalledWith('Content already open');
        dispose();
      });
    }
  );

  it.each([
    { mode: 'chat', type: 'agent_session', block: 'agent' },
    { mode: 'code', type: 'agent_session', block: 'agent' },
    { mode: 'chat', type: 'chat', block: 'chat' },
  ] as const)(
    'reuses $mode $type conversations across Agents routes and blocks',
    ({ mode, type, block }) => {
      const route: SplitContent = {
        type: 'component',
        id: agentsRouteId({ mode, conversation: { type, id: 'conversation' } }),
      };
      const entity: SplitContent = { type: block, id: 'conversation' };
      for (const [initial, target] of [
        [route, entity],
        [entity, route],
      ]) {
        createRoot((dispose) => {
          const orchestrator = createMockOrchestrator();
          const manager = createSplitLayout(orchestrator, [
            initial,
            { type: 'component', id: 'inbox' },
          ]);
          const [existing, other] = manager.splits();
          const mount = existing.mount;
          expect(manager.getSplitByContent(target.type, target.id)?.id).toBe(
            existing.id
          );

          manager.activateSplit(other.id);
          const direct = manager.createNewSplit({
            content: target,
            activate: true,
            allowDuplicate: true,
            referredFrom: 'sidebar',
          });
          expect(direct?.id).toBe(existing.id);
          expect(manager.activeSplitId()).toBe(existing.id);

          manager.activateSplit(other.id);
          const opened = manager.openWithSplit(target, {
            activate: true,
            allowDuplicate: true,
            handle: manager.getSplit(other.id),
          });
          expect(opened?.id).toBe(existing.id);
          expect(manager.activeSplitId()).toBe(existing.id);
          expect(manager.splits()).toHaveLength(2);
          expect(existing.mount).toBe(mount);
          expect(existing.content).toEqual(initial);
          expect(other.content).toEqual({ type: 'component', id: 'inbox' });
          dispose();
        });
      }
    }
  );

  it('rejects opening a previewed block until its mount is released', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const manager = createSplitLayout(orchestrator, [
        { type: 'component', id: 'inbox' },
      ]);
      const release = orchestrator.contentInstances.register(() => [
        {
          owner: 'preview',
          content: { type: 'channel', id: 'preview-channel' },
        },
      ]);

      expect(
        manager.openWithSplit(
          { type: 'channel', id: 'preview-channel' },
          { preferNewSplit: true }
        )
      ).toBeUndefined();
      expect(manager.splits()).toHaveLength(1);
      expect(orchestrator.createBlockInstance).not.toHaveBeenCalled();
      expect(toast.alert).toHaveBeenCalledWith('Content already open');

      release();
      manager.openWithSplit(
        { type: 'channel', id: 'preview-channel' },
        { preferNewSplit: true }
      );
      expect(manager.splits()).toHaveLength(2);
      expect(orchestrator.createBlockInstance).toHaveBeenCalledOnce();
      dispose();
    });
  });

  it('blocks detail-owned email through direct split creation, replacement, and history', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const manager = createSplitLayout(orchestrator, [
        { type: 'email', id: 'one' },
      ]);
      const handle = manager.getSplit(manager.splits()[0].id)!;
      handle.replace({ next: { type: 'email', id: 'two' } });
      const release = orchestrator.contentInstances.register(() => [
        { owner: 'detail', content: { type: 'email', id: 'one' } },
      ]);
      expect(
        manager.createNewSplit({
          content: { type: 'email', id: 'one' },
          referredFrom: null,
          allowDuplicate: true,
        })
      ).toBeUndefined();
      handle.replace({ next: { type: 'email', id: 'one' } });
      handle.goBack();
      handle.removeFromHistory((content) => content.id === 'two');
      expect(handle.content().id).toBe('two');
      expect(handle.history()).toHaveLength(2);
      release();
      handle.goBack();
      expect(handle.content().id).toBe('one');
      dispose();
    });
  });

  it('exposes split ownership before block mount and releases it on close', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const manager = createSplitLayout(orchestrator, [
        { type: 'email', id: 'one' },
      ]);
      expect(
        orchestrator.contentInstances.isOpenElsewhere({
          type: 'email',
          id: 'one',
        })
      ).toBe(true);
      manager.removeSplit(manager.splits()[0].id);
      expect(
        orchestrator.contentInstances.isOpenElsewhere({
          type: 'email',
          id: 'one',
        })
      ).toBe(false);
      dispose();
    });
  });

  it('navigates and closes adjacent list and detail splits independently', () => {
    createRoot((dispose) => {
      const manager = createSplitLayout(createMockOrchestrator(), [
        { type: 'component', id: 'inbox' },
        { type: 'md', id: 'detail' },
      ]);
      const [list, detail] = manager.splits();
      const listHandle = manager.getSplit(list.id)!;
      const detailHandle = manager.getSplit(detail.id)!;

      manager.openWithSplit(
        { type: 'email', id: 'thread' },
        { handle: listHandle }
      );
      expect(listHandle.content()).toEqual({ type: 'email', id: 'thread' });
      expect(detailHandle.content()).toEqual({ type: 'md', id: 'detail' });
      expect(manager.splits()).toHaveLength(2);

      listHandle.goBack();
      expect(listHandle.content()).toEqual({ type: 'component', id: 'inbox' });
      expect(detailHandle.content()).toEqual({ type: 'md', id: 'detail' });
      listHandle.close();
      expect(manager.splits().map((split) => split.id)).toEqual([detail.id]);
      dispose();
    });
  });

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
          { type: 'email', id: 'other' },
        ]);
        const [listSplitState, docSplitState] = manager.splits();
        const listSplit = manager.getSplit(listSplitState.id)!;
        const docSplit = manager.getSplit(docSplitState.id)!;

        // Visit the email, navigate away, then open it in the other split.
        listSplit.replace({ next: { type: 'email', id: 'doc-1' } });
        listSplit.replace({ next: { type: 'channel', id: 'ch-1' } });
        docSplit.replace({ next: { type: 'email', id: 'doc-1' } });

        const moved = listSplit.goBackTo(
          (content) => content.type === 'email' && content.id === 'doc-1'
        );

        // doc-1 is unmountable here, so nothing moves: the split keeps showing
        // the channel rather than stranding its history on an entry it never
        // mounted.
        expect(moved).toBe(false);
        expect(listSplit.content()).toMatchObject({
          type: 'channel',
          id: 'ch-1',
        });
        expect(docSplit.content()).toMatchObject({
          type: 'email',
          id: 'doc-1',
        });

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
        if (!handle) throw new Error('Expected content to open');

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
        if (!handle) throw new Error('Expected content to open');

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
        if (!inserted) throw new Error('Expected content to open');

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
    it('refreshes the list source when reopening an email already mounted in the native background', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'email', id: 'a' },
        ]);
        const detail = manager.getSplit(manager.splits()[0].id)!;
        const swipeLayout = createMobileSwipeLayout(manager);
        manager.openWithSplit({ type: 'component', id: 'mail' });
        const list = manager.getSplit(manager.activeSplitId()!)!;
        manager.openWithSplit(
          withListNavigationSource({ type: 'email', id: 'a' }, list),
          { handle: list, referredFrom: 'mail' }
        );
        expect(manager.activeSplitId()).toBe(detail.id);
        expect(detail.referredFrom()).toBe('mail');
        expect(listNavigationSourceId(detail)).toBe(list.id);
        expect(manager.splits()).toHaveLength(2);
        swipeLayout.swipeBack();
        expect(manager.activeSplitId()).toBe(list.id);
        dispose();
      });
    });

    it('preserves the native source list through repeated email steps and swipe back', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'mail', state: { 'mail.tab': 'noise' } },
        ]);
        const list = manager.getSplit(manager.splits()[0].id)!;
        const disposeListSource = createRoot((dispose) => {
          registerListNavigationSource(list, {
            viewId: 'mail',
            entities: () => [],
            hasMore: () => false,
            loadMore: async () => {},
          });
          return dispose;
        });
        const source = getListNavigationSource(list.id);
        const swipeLayout = createMobileSwipeLayout(manager);
        manager.openWithSplit(
          withListNavigationSource({ type: 'email', id: 'a' }, list),
          { handle: list, referredFrom: 'mail' }
        );
        const detail = manager.getSplit(manager.activeSplitId()!)!;
        expect(detail.id).not.toBe(list.id);
        expect(getListNavigationSource(listNavigationSourceId(detail))).toBe(
          source
        );

        for (const id of ['b', 'c']) {
          manager.openWithSplit(
            withListNavigationSource({ type: 'email', id }, detail),
            { handle: detail, referredFrom: 'mail', mergeHistory: true }
          );
          expect(manager.activeSplitId()).toBe(detail.id);
          expect(detail.content().id).toBe(id);
          expect(getListNavigationSource(listNavigationSourceId(detail))).toBe(
            source
          );
          expect(manager.splits()).toHaveLength(2);
          expect(list.content().state?.['mail.tab']).toBe('noise');
        }
        // Opening an attachment discards the background list. Its component
        // disposes the source; swipe-back mounts that history entry anew.
        manager.openWithSplit(
          { type: 'md', id: 'attachment' },
          { handle: detail, referredFrom: 'attachment' }
        );
        expect(manager.getSplit(list.id)).toBeUndefined();
        disposeListSource();
        expect(
          getListNavigationSource(listNavigationSourceId(detail))
        ).toBeUndefined();
        swipeLayout.swipeBack();
        expect(manager.activeSplitId()).toBe(detail.id);
        const restoredList = manager.getSplit(
          manager.splits().find((split) => split.content.id === 'mail')!.id
        )!;
        expect(restoredList.id).not.toBe(list.id);
        expect(restoredList.content().state?.['mail.tab']).toBe('noise');
        registerListNavigationSource(restoredList, source!);
        expect(getListNavigationSource(listNavigationSourceId(detail))).toBe(
          source
        );
        manager.openWithSplit(
          withListNavigationSource({ type: 'email', id: 'd' }, detail),
          { handle: detail, referredFrom: 'mail', mergeHistory: true }
        );
        expect(detail.content().id).toBe('d');
        swipeLayout.swipeBack();
        expect(manager.activeSplitId()).toBe(restoredList.id);
        expect(restoredList.content().id).toBe('mail');
        dispose();
      });
    });

    it('refuses to activate an excluded split', () => {
      createRoot((dispose) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'foreground' },
          { type: 'md', id: 'background' },
        ]);

        const [fg, bg] = manager.splits();
        expect(shouldShowSplitCloseButton(manager)).toBe(true);
        manager.activateSplit(fg.id);
        manager.setExclusionFilter((split) => split.id === bg.id);
        expect(shouldShowSplitCloseButton(manager)).toBe(false);

        manager.activateSplit(bg.id);
        expect(manager.activeSplitId()).toBe(fg.id);

        manager.setExclusionFilter(undefined);
        expect(shouldShowSplitCloseButton(manager)).toBe(true);
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

  describe('popover splits', () => {
    it('lets an onClose handler decide when a popover finishes closing', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), []);
        const onClose = vi.fn();
        const popover = manager.createPopoverSplit({
          content: { type: 'component', id: 'composer' },
          onClose,
        });
        if (!popover) throw new Error('Expected content to open');

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
        if (!popover) throw new Error('Expected content to open');

        popover.close();

        expect(popover.isOpen()).toBe(false);
        dispose();
      });
    });
  });
});
