import { agentsRouteId } from '@app/features/agents-view/core/route';
import { CALENDAR_PREFERENCES_KEY } from '@app/features/calendar/calendar-preferences';
import { driveDestination } from '@app/features/drive-view/drive-route-navigation';
import { driveSplitRoute } from '@app/features/drive-view/route';
import {
  emailSplitRoute,
  emailThreadRoute,
} from '@app/features/email-view/route';
import {
  getListNavigationSource,
  listNavigationSourceId,
  registerListNavigationSource,
  withListNavigationSource,
} from '@app/features/soup/collection/list-navigation-source';
import { taskDetailRoute } from '@app/features/tasks-view/route';
import { createMemorySplitRouterLocation } from '@app/lib/split-router/integrations/memory';
import { createSplitRouter } from '@app/lib/split-router/router';
import { createRoutesManifest } from '@app/lib/split-router/routes';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { toast } from '@core/component/Toast/Toast';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
} from '../layoutManager';
import {
  closeSplitOrReturnToList,
  shouldShowSplitCloseButton,
} from '../layoutUtils';
import { createMobileSwipeLayout } from '../mobile/createMobileSwipeLayout';
import { createAppSplitRouterMiddleware } from '../split-router/app-middleware';
import { appSplitRoutes } from '../split-router/app-routes';
import { createAppSplitRouterLayout } from '../splitRouterLayout';

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
  describe('header close action', () => {
    it.each([false, true])(
      'returns the sole visible split to its prior list (excluded background: %s)',
      (withBackground) => {
        createRoot((dispose) => {
          const manager = createSplitLayout(createMockOrchestrator(), [
            { type: 'component', id: 'inbox' },
          ]);
          const split = manager.getSplit(manager.splits()[0].id)!;
          const list: SplitContent = {
            type: 'component',
            id: 'tasks',
            state: { filter: 'assigned' },
          };
          split.replace({ next: list });
          split.replace({ next: { type: 'md', id: 'doc-1' } });
          split.replace({ next: { type: 'md', id: 'doc-2' } });
          if (withBackground) {
            const background = manager.createNewSplit({
              content: { type: 'md', id: 'background' },
              activate: false,
              referredFrom: null,
            })!;
            manager.setExclusionFilter((entry) => entry.id === background.id);
          }

          closeSplitOrReturnToList(manager, split);

          expect(manager.getVisibleSplitCount()).toBe(1);
          expect(manager.splits()).toHaveLength(withBackground ? 2 : 1);
          expect(split.content()).toEqual(list);
          expect(split.canGoForward()).toBe(true);
          split.goBack();
          expect(split.content()).toEqual({ type: 'component', id: 'inbox' });
          dispose();
        });
      }
    );

    it('falls back to inbox without keeping the current detail as a Back entry', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'direct-link' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        closeSplitOrReturnToList(manager, split);
        expect(split.content()).toEqual({ type: 'component', id: 'inbox' });
        expect(split.canGoBack()).toBe(false);
        dispose();
      });
    });

    it('closes the panel when another visible split remains', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'detail' },
          { type: 'component', id: 'tasks' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        closeSplitOrReturnToList(manager, split);
        expect(manager.getSplit(split.id)).toBeUndefined();
        expect(manager.splits().map((entry) => entry.content.id)).toEqual([
          'tasks',
        ]);
        dispose();
      });
    });

    it('leaves a sole list unchanged', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'tasks' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        closeSplitOrReturnToList(manager, split);
        expect(split.content()).toEqual({ type: 'component', id: 'tasks' });
        expect(manager.getVisibleSplitCount()).toBe(1);
        dispose();
      });
    });
  });

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
        expect(toast.alert).not.toHaveBeenCalled();
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
          const view = manager.findOpenView(target);
          expect(view?.owner).toBe(existing.id);
          expect(view?.topLevelSplit?.id).toBe(existing.id);
          expect(view?.content).toEqual(entity);
          expect(manager.activeSplitId()).toBe(other.id);
          const direct = manager.createNewSplit({
            content: target,
            activate: true,
            allowDuplicate: true,
            referredFrom: 'sidebar',
          });
          expect(direct?.id).toBe(existing.id);
          expect(manager.activeSplitId()).toBe(existing.id);

          manager.activateSplit(other.id);
          vi.mocked(toast.alert).mockClear();
          const opened = manager.openWithSplit(target, {
            activate: true,
            allowDuplicate: true,
            handle: manager.getSplit(other.id),
          });
          expect(opened).toMatchObject({
            status: 'reused',
            owner: existing.id,
            sourceOwner: other.id,
          });
          expect(opened.split?.id).toBe(existing.id);
          expect(manager.activeSplitId()).toBe(existing.id);
          expect(manager.splits()).toHaveLength(2);
          expect(existing.mount).toBe(mount);
          expect(existing.content).toEqual(initial);
          expect(other.content).toEqual({ type: 'component', id: 'inbox' });
          expect(toast.alert).not.toHaveBeenCalled();

          manager.openWithSplit(target);
          expect(toast.alert).not.toHaveBeenCalled();
          dispose();
        });
      }
    }
  );

  it('reports reuse even when the owning view has no activation target', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const manager = createSplitLayout(orchestrator, [
        { type: 'component', id: 'inbox' },
      ]);
      const release = manager.registerOpenViews(() => [
        {
          owner: 'preview',
          content: { type: 'channel', id: 'preview-channel' },
        },
      ]);

      vi.mocked(toast.alert).mockClear();
      expect(
        manager.openWithSplit(
          { type: 'channel', id: 'preview-channel' },
          { preferNewSplit: true }
        )
      ).toMatchObject({ status: 'reused', owner: 'preview' });
      expect(manager.splits()).toHaveLength(1);
      expect(orchestrator.createBlockInstance).not.toHaveBeenCalled();
      expect(toast.alert).not.toHaveBeenCalled();

      manager.openWithSplit(
        { type: 'channel', id: 'preview-channel' },
        { preferNewSplit: true }
      );
      expect(manager.splits()).toHaveLength(1);
      expect(orchestrator.createBlockInstance).not.toHaveBeenCalled();
      expect(toast.alert).not.toHaveBeenCalled();

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

  it.each([
    {
      name: 'channel',
      content: { type: 'channel', id: 'conversation' },
      target: { type: 'channel', id: 'conversation' },
    },
    ...(
      [
        { mode: 'chat', type: 'agent_session', block: 'agent' },
        { mode: 'code', type: 'agent_session', block: 'agent' },
        { mode: 'chat', type: 'chat', block: 'chat' },
      ] as const
    ).map(({ mode, type, block }) => ({
      name: `${mode} ${type}`,
      content: { type: block, id: 'conversation' },
      target: {
        type: 'component' as const,
        id: agentsRouteId({ mode, conversation: { type, id: 'conversation' } }),
      },
    })),
  ] satisfies { name: string; content: SplitContent; target: SplitContent }[])(
    'reports inline $name reuse without notifications',
    ({ content, target }) => {
      createRoot((dispose) => {
        const orchestrator = createMockOrchestrator();
        const manager = createSplitLayout(orchestrator, [
          { type: 'component', id: 'channels' },
          { type: 'component', id: 'inbox' },
        ]);
        const [chat, inbox] = manager.splits();
        manager.activateSplit(inbox.id);
        const activate = vi.fn(() => manager.activateSplit(chat.id));
        manager.registerOpenViews(() => [
          { owner: 'preview', content, activate },
        ]);
        const intercept = vi.fn(() => ({ status: 'unavailable' as const }));
        manager.setSplitNavigationInterceptor(intercept);

        const view = manager.findOpenView(target);
        expect(view?.owner).toBe('preview');
        expect(view?.content).toEqual(content);
        expect(view?.topLevelSplit).toBeUndefined();
        expect(activate).not.toHaveBeenCalled();

        vi.mocked(toast.alert).mockClear();
        const result = manager.openWithSplit(target, {
          referredFrom: 'kommand-menu',
        });
        expect(result).toMatchObject({ status: 'reused', owner: 'preview' });
        expect(result.split).toBeUndefined();
        expect(activate).toHaveBeenCalledOnce();
        expect(manager.activeSplitId()).toBe(chat.id);
        expect(toast.alert).not.toHaveBeenCalled();

        vi.mocked(toast.alert).mockClear();
        manager.activateSplit(inbox.id);
        manager.openWithSplit(target);
        expect(activate).toHaveBeenCalledTimes(2);
        expect(manager.activeSplitId()).toBe(chat.id);
        expect(manager.splits()).toHaveLength(2);
        expect(orchestrator.createBlockInstance).not.toHaveBeenCalled();
        expect(toast.alert).not.toHaveBeenCalled();

        manager.activateSplit(inbox.id);
        manager.openWithSplit(target, { activate: false });
        expect(activate).toHaveBeenCalledTimes(2);
        expect(manager.activeSplitId()).toBe(inbox.id);
        expect(toast.alert).not.toHaveBeenCalled();
        expect(intercept).not.toHaveBeenCalled();
        dispose();
      });
    }
  );

  it('reports the owner when reusing a standalone split', () => {
    createRoot((dispose) => {
      const manager = createSplitLayout(createMockOrchestrator(), [
        { type: 'channel', id: 'channel' },
        { type: 'component', id: 'inbox' },
      ]);
      const [channel, inbox] = manager.splits();
      manager.activateSplit(inbox.id);
      vi.mocked(toast.alert).mockClear();
      manager.openWithSplit(channel.content);
      expect(manager.activeSplitId()).toBe(channel.id);
      expect(toast.alert).not.toHaveBeenCalled();
      vi.mocked(toast.alert).mockClear();
      manager.activateSplit(inbox.id);
      manager.openWithSplit(channel.content);
      expect(manager.activeSplitId()).toBe(channel.id);
      expect(toast.alert).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('finds an existing shell even when an open action allows duplicating it', () => {
    createRoot((dispose) => {
      const content = { type: 'component', id: 'channels' } as const;
      const manager = createSplitLayout(createMockOrchestrator(), [
        content,
        { type: 'component', id: 'inbox' },
      ]);
      const [channels, inbox] = manager.splits();
      manager.activateSplit(inbox.id);
      vi.mocked(toast.alert).mockClear();

      expect(manager.findOpenView(content)?.topLevelSplit?.id).toBe(
        channels.id
      );
      expect(manager.activeSplitId()).toBe(inbox.id);
      expect(toast.alert).not.toHaveBeenCalled();

      const duplicate = manager.openWithSplit(content, {
        preferNewSplit: true,
        allowDuplicate: true,
      });
      expect(duplicate.status).toBe('opened');
      expect(duplicate.split?.id).not.toBe(channels.id);
      expect(manager.splits()).toHaveLength(3);
      expect(manager.findOpenView(content)?.topLevelSplit?.id).toBe(
        channels.id
      );
      expect(toast.alert).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('distinguishes opening new content from reusing content in the source split', () => {
    createRoot((dispose) => {
      const manager = createSplitLayout(createMockOrchestrator(), [
        { type: 'component', id: 'inbox' },
      ]);
      const handle = manager.getSplit(manager.splits()[0].id)!;
      const content = { type: 'email', id: 'selected' } as const;
      vi.mocked(toast.alert).mockClear();
      expect(manager.openWithSplit(content, { handle })).toMatchObject({
        status: 'opened',
        split: { id: handle.id },
      });
      expect(manager.openWithSplit(content, { handle })).toMatchObject({
        status: 'reused',
        owner: handle.id,
        sourceOwner: handle.id,
        split: { id: handle.id },
      });
      expect(handle.content()).toMatchObject(content);
      expect(toast.alert).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('restoring occupied content does not focus or notify its owner', () => {
    createRoot((dispose) => {
      const manager = createSplitLayout(createMockOrchestrator(), [
        { type: 'component', id: 'inbox' },
      ]);
      const source = manager.splits()[0];
      const content = { type: 'email', id: 'occupied' } as const;
      const activate = vi.fn();
      manager.registerOpenViews(() => [
        { owner: 'preview', content, activate },
      ]);
      vi.mocked(toast.alert).mockClear();
      manager.reconcile([content]);
      expect(manager.splits()[0].content).toEqual(source.content);
      expect(activate).not.toHaveBeenCalled();
      expect(toast.alert).not.toHaveBeenCalled();
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
      const release = manager.registerOpenViews(() => [
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

  it.each(['replace', 'adopt', 'replaceAll', 'popover'] as const)(
    '%s focuses an inline owner when it refuses duplicate content',
    (action) => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'email', id: 'pending' },
          { type: 'component', id: 'mail' },
        ]);
        const [source, host] = manager.splits();
        const handle = manager.getSplit(source.id)!;
        const target = { type: 'email', id: 'owned' } as const;
        manager.registerOpenViews(() => [
          {
            owner: 'detail',
            content: target,
            activate: () => manager.activateSplit(host.id),
          },
        ]);
        handle.activate();
        vi.mocked(toast.alert).mockClear();

        if (action === 'replace') handle.replace({ next: target });
        if (action === 'adopt')
          handle.adoptContentId({ type: 'email', nextId: target.id });
        if (action === 'replaceAll') manager.replaceAllSplits(target);
        if (action === 'popover')
          manager.createPopoverSplit({ content: target });

        expect(manager.activeSplitId()).toBe(host.id);
        expect(handle.content().id).toBe('pending');
        expect(handle.history()).toHaveLength(1);
        expect(manager.splits()).toHaveLength(2);
        expect(toast.alert).not.toHaveBeenCalled();
        dispose();
      });
    }
  );

  it.each(['replace', 'adopt'] as const)(
    '%s focuses an existing block instead of mounting its Agents route',
    (action) => {
      createRoot((dispose) => {
        const orchestrator = createMockOrchestrator();
        const manager = createSplitLayout(orchestrator, [
          { type: 'chat', id: 'conversation' },
          { type: 'component', id: 'agents' },
        ]);
        const [owner, source] = manager.splits();
        const handle = manager.getSplit(source.id)!;
        const route = agentsRouteId({
          mode: 'chat',
          conversation: { type: 'chat', id: 'conversation' },
        });
        const mount = source.mount;
        handle.activate();
        if (action === 'replace')
          handle.replace({ next: { type: 'component', id: route } });
        else handle.adoptContentId({ type: 'component', nextId: route });
        expect(manager.activeSplitId()).toBe(owner.id);
        expect(handle.content().id).toBe('agents');
        expect(manager.splits()[1].mount).toBe(mount);
        expect(orchestrator.createBlockInstance).toHaveBeenCalledTimes(1);
        dispose();
      });
    }
  );

  it('exposes split ownership before block mount and releases it on close', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const manager = createSplitLayout(orchestrator, [
        { type: 'email', id: 'one' },
      ]);
      expect(
        manager.findOpenView({
          type: 'email',
          id: 'one',
        })
      ).toBeDefined();
      manager.removeSplit(manager.splits()[0].id);
      expect(
        manager.findOpenView({
          type: 'email',
          id: 'one',
        })
      ).toBeUndefined();
      dispose();
    });
  });

  it('scopes content ownership to the layout even when an orchestrator is shared', () => {
    createRoot((dispose) => {
      const orchestrator = createMockOrchestrator();
      const content = { type: 'channel', id: 'channel' } as const;
      const first = createSplitLayout(orchestrator, [content]);
      const second = createSplitLayout(orchestrator, []);

      expect(first.findOpenView(content)).toBeDefined();
      expect(second.findOpenView(content)).toBeUndefined();

      dispose();
      expect(first.findOpenView(content)).toBeUndefined();
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
    it('uses the retained split id for history ownership after reconciliation', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const handle = manager.getSplit(manager.splits()[0].id)!;
        const content = { type: 'email', id: 'same-entity' } as const;
        manager.reconcile([content]);
        expect(manager.splits()[0].id).toBe(handle.id);
        handle.replace({ next: content });
        expect(handle.canGoBack()).toBe(true);
        handle.goBack();
        expect(handle.history()).toHaveLength(1);
        expect(handle.canGoForward()).toBe(true);
        dispose();
      });
    });

    it('keeps history availability configured after reset', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const handle = manager.getSplit(manager.splits()[0].id)!;
        handle.reset();
        expect(handle.history()).toEqual([{ type: 'component', id: 'inbox' }]);
        expect(handle.canGoBack()).toBe(false);
        handle.replace({ next: { type: 'email', id: 'occupied' } });
        handle.replace({ next: { type: 'email', id: 'current' } });
        const release = manager.registerOpenViews(() => [
          { owner: 'preview', content: { type: 'email', id: 'occupied' } },
        ]);
        expect(handle.canGoBack()).toBe(true);
        handle.goBack();
        expect(handle.content().id).toBe('inbox');
        handle.goForward();
        expect(handle.content().id).toBe('current');
        release();
        expect(handle.canGoBack()).toBe(true);
        handle.goBack();
        expect(handle.content().id).toBe('occupied');
        dispose();
      });
    });

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

  describe('router layout synchronization', () => {
    function ingressRouter(
      url: string,
      options: { enabled?: boolean; loading?: boolean; touch?: boolean } = {}
    ) {
      return createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const routes = createRoutesManifest(appSplitRoutes);
        const location = createMemorySplitRouterLocation(url);
        const router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location,
          middleware: createAppSplitRouterMiddleware({
            newAppViews: () => ({
              enabled: options.enabled ?? true,
              loading: options.loading ?? false,
            }),
            isTouchDevice: () => options.touch ?? false,
          }),
        });
        return { manager, location, router, dispose };
      });
    }

    it.each([
      ['md', 'md'],
      ['pdf', 'pdf'],
      ['canvas', 'canvas'],
      ['task', 'md'],
      ['snippet', 'md'],
      ['skill', 'md'],
      ['csv', 'code'],
      ['code', 'code'],
      ['image', 'image'],
      ['video', 'video'],
      ['spreadsheet', 'spreadsheet'],
      ['unknown', 'unknown'],
    ])(
      'preserves legacy %s blocks on touch, including canonical links',
      async (type, blockType) => {
        for (const path of [
          `/${blockType}/doc`,
          `/drive/${type}/doc`,
          `/drive/shared/${type}/doc`,
          `/drive/folder/folder/${type}/doc`,
        ]) {
          const { manager, location, router, dispose } = ingressRouter(path, {
            touch: true,
          });
          await router.settled();
          expect(location.read().pathname).toBe(`/${blockType}/doc`);
          expect(manager.splits()[0].content).toMatchObject({
            type: blockType,
            id: 'doc',
          });
          expect(location.history()).toHaveLength(1);
          router.dispose();
          dispose();
        }
      }
    );

    it('keeps Drive list routes on touch', async () => {
      const { location, router, dispose } = ingressRouter(
        '/drive/~/drive/shared/~/drive/folder/folder',
        { touch: true }
      );
      await router.settled();
      expect(location.read().pathname).toBe(
        '/drive/~/drive/shared/~/drive/folder/folder'
      );
      router.dispose();
      dispose();
    });

    it('renders Calendar as a route-backed component and restores URL state', async () => {
      const { manager, location, router, dispose } = ingressRouter(
        '/calendar/week?eventId=event-1'
      );
      await router.settled();
      const split = manager.splits()[0];
      const mount = split.mount;
      expect(split.content).toMatchObject({
        type: 'component',
        id: 'calendar',
      });
      expect(mount.kind).toBe('component');
      expect(router.route(split.id)?.matches).toEqual([
        { id: 'view-calendar', params: { period: 'timeGridWeek' } },
      ]);
      expect(router.search(split.id, 'calendar')).toEqual({
        eventId: ['event-1'],
      });
      expect(location.read().pathname).toBe('/calendar/week');
      expect(new URLSearchParams(location.read().search).get('eventId')).toBe(
        'event-1'
      );
      expect(
        new URLSearchParams(location.read().search).get('s0.calendar.eventId')
      ).toBe('event-1');

      location.set('/calendar/day?s0.calendar.eventId=event-2');
      await router.settled();
      expect(manager.splits()[0].mount).toBe(mount);
      expect(router.route(split.id)?.matches).toEqual([
        { id: 'view-calendar', params: { period: 'timeGridDay' } },
      ]);
      expect(router.search(split.id, 'calendar')).toEqual({
        eventId: ['event-2'],
      });
      router.dispose();
      dispose();
    });

    it('upgrades the legacy Calendar block URL to the preferred period route', async () => {
      localStorage.setItem(
        CALENDAR_PREFERENCES_KEY,
        JSON.stringify({ periodView: 'dayGridMonth' })
      );
      const { manager, location, router, dispose } = ingressRouter(
        '/calendar/view?eventId=legacy-event'
      );
      await router.settled();
      const split = manager.splits()[0];
      expect(split.content).toMatchObject({
        type: 'component',
        id: 'calendar',
      });
      expect(location.read().pathname).toBe('/calendar/month');
      expect(router.search(split.id, 'calendar')).toEqual({
        eventId: ['legacy-event'],
      });
      localStorage.removeItem(CALENDAR_PREFERENCES_KEY);
      router.dispose();
      dispose();
    });

    it('normalizes legacy search per detail pane without overriding canonical values', async () => {
      const { manager, location, router, dispose } = ingressRouter(
        '/mail/one/~/channels/c1/~/mail/two/~/mail' +
          '?email_message_id=legacy&channel_message_id=first&channel_message_id=last' +
          '&channel_thread_id=thread&s0.email-detail.messageId=explicit' +
          '&s0.email-detail.extra=keep&s2.email-detail.messageId=&referral_code=code#focus'
      );
      await router.settled();
      const [firstMail, channel, secondMail, mailList] = manager.splits();
      expect(router.search(firstMail.id, 'email-detail')).toEqual({
        messageId: ['explicit'],
        extra: ['keep'],
      });
      expect(router.search(channel.id, 'channel-detail')).toEqual({
        messageId: ['first', 'last'],
        threadId: ['thread'],
      });
      expect(router.search(secondMail.id, 'email-detail')).toEqual({
        messageId: [''],
      });
      expect(router.search(mailList.id, 'email-detail')).toBeUndefined();
      expect(
        new URLSearchParams(location.read().search).get('referral_code')
      ).toBe('code');
      expect(location.read().hash).toBe('#focus');
      expect(location.history()).toHaveLength(1);
      router.dispose();
      dispose();
    });

    it('normalizes every external URL and restores targets through browser history', async () => {
      const { manager, location, router, dispose } = ingressRouter(
        '/mail/one?email_message_id=first'
      );
      await router.settled();
      const split = manager.splits()[0];
      const mount = split.mount;
      expect(router.search(split.id, 'email-detail')).toEqual({
        messageId: ['first'],
      });

      location.set('/mail/one?email_message_id=second');
      await router.settled();
      expect(router.search(split.id, 'email-detail')).toEqual({
        messageId: ['second'],
      });
      expect(location.history()).toHaveLength(2);
      expect(manager.splits()[0].mount).toBe(mount);

      expect(location.back()).toBe(true);
      await router.settled();
      expect(router.search(split.id, 'email-detail')).toEqual({
        messageId: ['first'],
      });
      expect(location.forward()).toBe(true);
      await router.settled();
      expect(router.search(split.id, 'email-detail')).toEqual({
        messageId: ['second'],
      });
      expect(location.history()).toHaveLength(2);
      router.dispose();
      dispose();
    });

    it.each([
      { enabled: false, loading: false, touch: false },
      { enabled: true, loading: true, touch: false },
      { enabled: true, loading: false, touch: true },
    ])(
      'preserves full-block legacy targets when inline detail is unsupported: %o',
      async (options) => {
        const { location, router, dispose } = ingressRouter(
          '/email/one/~/channel/c1?email_message_id=message&channel_message_id=first' +
            '&channel_message_id=last&channel_thread_id=thread',
          options
        );
        await router.settled();
        expect(location.read().pathname).toBe('/email/one/~/channel/c1');
        const query = new URLSearchParams(location.read().search);
        expect(query.getAll('email_message_id')).toEqual(['message']);
        expect(query.getAll('channel_message_id')).toEqual(['first', 'last']);
        expect(query.get('channel_thread_id')).toBe('thread');
        expect(
          [...query.keys()].some(
            (key) => key.startsWith('s0.') || key.startsWith('s1.')
          )
        ).toBe(false);
        router.dispose();
        dispose();
      }
    );

    it('upgrades renderable legacy details and preserves repeated raw target values', async () => {
      let dispose!: () => void;
      let router!: ReturnType<typeof createSplitRouter<string>>;
      let location!: ReturnType<typeof createMemorySplitRouterLocation>;
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'email', id: 'thread-1' },
        ]);
        const routes = createRoutesManifest(appSplitRoutes);
        location = createMemorySplitRouterLocation(
          '/email/thread-1?email_message_id=first&email_message_id=last'
        );
        router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location,
          middleware: createAppSplitRouterMiddleware({
            newAppViews: () => ({ enabled: true, loading: false }),
            isTouchDevice: () => false,
          }),
        });
      });

      await router.settled();
      expect(location.read().pathname).toBe('/mail/thread-1');
      const query = new URLSearchParams(location.read().search);
      expect(query.getAll('email_message_id')).toEqual(['first', 'last']);
      expect(query.getAll('s0.email-detail.messageId')).toEqual([
        'first',
        'last',
      ]);
      expect(location.history()).toHaveLength(1);
      dispose();
    });

    it.each([
      { enabled: false, touch: false },
      { enabled: true, touch: true },
      { enabled: false, touch: true },
    ])(
      'keeps legacy task detail when enabled=$enabled and touch=$touch',
      async ({ enabled, touch }) => {
        let dispose!: () => void;
        let router!: ReturnType<typeof createSplitRouter<string>>;
        let location!: ReturnType<typeof createMemorySplitRouterLocation>;
        createRoot((rootDispose) => {
          dispose = rootDispose;
          const manager = createSplitLayout(createMockOrchestrator(), [
            { type: 'task', id: 'task-1' },
          ]);
          const routes = createRoutesManifest(appSplitRoutes);
          location = createMemorySplitRouterLocation('/task/task-1');
          router = createSplitRouter({
            routes,
            layout: createAppSplitRouterLayout(manager, routes),
            location,
            middleware: createAppSplitRouterMiddleware({
              newAppViews: () => ({ enabled, loading: false }),
              isTouchDevice: () => touch,
            }),
          });
        });

        await router.settled();
        expect(location.read().pathname).toBe('/task/task-1');
        dispose();
      }
    );

    it('keeps a migrated workspace mounted across typed detail history', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'mail' },
        ]);
        const routes = createRoutesManifest(appSplitRoutes);
        const router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location: createMemorySplitRouterLocation('/mail'),
        });
        const split = manager.splits()[0]!;
        const mount = split.mount;
        const handle = manager.getSplit(split.id)!;
        const stopCapture = handle.registerEntryStateCaptor(
          'email.listState',
          () => ({
            focusKey: 'one',
            scrollOffset: 420,
          })
        );

        router.navigate(split.id, {
          route: emailThreadRoute,
          params: { threadId: 'one' },
        });
        stopCapture(); // The list is disposed when its detail outlet takes over.
        expect(handle.currentEntryState()).toMatchObject({
          'email.listState': { focusKey: 'one', scrollOffset: 420 },
        });
        router.navigate(split.id, {
          route: emailThreadRoute,
          params: { threadId: 'two' },
        });

        expect(manager.splits()[0]?.mount).toBe(mount);
        expect(manager.splits()[0]?.content).toMatchObject({
          type: 'component',
          id: 'mail',
        });
        expect(router.route(split.id)?.matches.at(-1)?.params).toEqual({
          threadId: 'two',
        });

        router.navigate(split.id, -1);
        expect(router.route(split.id)?.matches.at(-1)?.params).toEqual({
          threadId: 'one',
        });
        router.navigate(split.id, {
          route: emailSplitRoute,
          params: {},
        });
        expect(router.route(split.id)?.matches).toEqual([
          { id: 'view-mail', params: {} },
        ]);
        expect(manager.splits()[0]?.mount).toBe(mount);
        router.dispose();
        dispose();
      });
    });

    it('uses canonical detail claims across routed workspaces and legacy blocks', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'tasks' },
          { type: 'md', id: 'task-1' },
        ]);
        const routes = createRoutesManifest(appSplitRoutes);
        const router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location: createMemorySplitRouterLocation('/tasks/~/md/task-1'),
        });
        const [tasks, legacy] = manager.splits();
        const accepted = router.route(tasks.id);

        router.navigate(tasks.id, {
          route: taskDetailRoute,
          params: { taskId: 'task-1' },
        });

        expect(router.route(tasks.id)).toEqual(accepted);
        expect(manager.activeSplitId()).toBe(legacy.id);
        expect(manager.splits()).toHaveLength(2);
        router.dispose();
        dispose();
      });
    });

    it('keeps duplicate list roots independent while reusing claimed email details', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'mail' },
          { type: 'component', id: 'mail' },
        ]);
        const routes = createRoutesManifest(appSplitRoutes);
        const router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location: createMemorySplitRouterLocation('/mail/one/~/mail'),
        });
        const [owner, other] = manager.splits();
        const otherRoute = router.route(other.id);
        manager.activateSplit(other.id);

        router.navigate(other.id, {
          route: emailThreadRoute,
          params: { threadId: 'one' },
        });

        expect(router.route(other.id)).toEqual(otherRoute);
        expect(manager.activeSplitId()).toBe(owner.id);
        expect(manager.splits()).toHaveLength(2);
        router.dispose();
        dispose();
      });
    });

    it.each(['drive', 'drive/md/second-document'])(
      'navigates a second Drive pane independently from %s, including history',
      (initialPath) => {
        createRoot((dispose) => {
          const manager = createSplitLayout(createMockOrchestrator(), [
            { type: 'component', id: 'documents' },
            { type: 'component', id: 'documents' },
          ]);
          const routes = createRoutesManifest({
            definitions: [driveSplitRoute],
          });
          const router = createSplitRouter({
            routes,
            layout: createAppSplitRouterLayout(manager, routes),
            location: createMemorySplitRouterLocation(
              `/drive/~/${initialPath}`
            ),
          });
          const [first, second] = manager.splits();
          const firstRoute = router.route(first.id);
          manager.activateSplit(second.id);

          router.navigate(second.id, '/drive/folder/second-folder');
          const folderRoute = router.route(second.id);
          expect(folderRoute?.matches.at(-1)).toEqual({
            id: 'drive-folder',
            params: { view: 'folder', folderId: 'second-folder' },
          });
          expect(router.route(first.id)).toEqual(firstRoute);
          expect(manager.activeSplitId()).toBe(second.id);

          router.navigate(second.id, '/drive/md/another-document');
          expect(router.route(second.id)?.matches.at(-1)?.params).toEqual({
            documentType: 'md',
            documentId: 'another-document',
          });
          router.navigate(second.id, -1);
          expect(router.route(second.id)).toEqual(folderRoute);
          expect(router.route(first.id)).toEqual(firstRoute);
          expect(manager.activeSplitId()).toBe(second.id);

          router.navigate(second.id, '/drive/shared');
          expect(router.route(second.id)?.matches.at(-1)).toEqual({
            id: 'drive-tab',
            params: { tab: 'shared' },
          });
          router.navigate(
            second.id,
            driveDestination(
              { kind: 'folder', id: 'another-folder' },
              { type: 'md', id: 'nested-document' }
            )
          );
          expect(router.route(second.id)?.matches).toEqual([
            { id: 'drive', params: {} },
            {
              id: 'drive-folder',
              params: { view: 'folder', folderId: 'another-folder' },
            },
            {
              id: 'drive-folder-document',
              params: { documentType: 'md', documentId: 'nested-document' },
            },
          ]);
          expect(router.route(first.id)).toEqual(firstRoute);
          expect(manager.splits()).toHaveLength(2);
          router.dispose();
          dispose();
        });
      }
    );

    it('still activates the owner when another Drive pane opens the same document', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'documents' },
          { type: 'component', id: 'documents' },
        ]);
        const routes = createRoutesManifest({
          definitions: [driveSplitRoute],
        });
        const router = createSplitRouter({
          routes,
          layout: createAppSplitRouterLayout(manager, routes),
          location: createMemorySplitRouterLocation(
            '/drive/md/first-document/~/drive/md/second-document'
          ),
        });
        const [first, second] = manager.splits();
        const secondRoute = router.route(second.id);
        manager.activateSplit(second.id);

        router.navigate(second.id, '/drive/md/first-document');

        expect(manager.activeSplitId()).toBe(first.id);
        expect(router.route(second.id)).toEqual(secondRoute);
        expect(manager.splits()).toHaveLength(2);
        router.dispose();
        dispose();
      });
    });

    it('does not publish manager updates that leave router state unchanged', async () => {
      let dispose!: () => void;
      let updateEntry!: (state: Record<string, unknown>) => void;
      let updateLocation!: (folderId?: string) => void;
      const listener = vi.fn();

      createRoot((rootDispose) => {
        dispose = rootDispose;
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'documents' },
        ]);
        const split = manager.getSplit(manager.splits()[0]!.id)!;
        const layout = createAppSplitRouterLayout(
          manager,
          createRoutesManifest({
            definitions: [
              {
                id: 'drive',
                path: 'drive',
                children: [{ id: 'drive-folder', path: 'folder/:folderId' }],
              },
            ],
          })
        );
        layout.subscribe(listener);

        updateEntry = (state) => {
          split.updateCurrentEntry((current) => ({ ...current, state }));
        };
        updateLocation = (folderId) => {
          split.updateCurrentEntry((current) => ({
            ...current,
            entryMetadata: {
              route: {
                matches: folderId
                  ? [
                      { id: 'drive', params: {} },
                      { id: 'drive-folder', params: { folderId } },
                    ]
                  : [{ id: 'drive', params: {} }],
              },
            },
          }));
        };
      });
      await Promise.resolve();

      updateEntry({ scrollOffset: 120 });
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();

      updateLocation();
      await Promise.resolve();

      expect(listener).not.toHaveBeenCalled();

      updateLocation('folder-1');
      await Promise.resolve();

      expect(listener).toHaveBeenCalledOnce();
      dispose();
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

  describe('entry metadata', () => {
    it('skips structurally equal metadata during reconciliation', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          {
            type: 'component',
            id: 'documents',
            entryMetadata: {
              route: { matches: [{ id: 'drive', params: {} }] },
              search: { drive: { tags: ['one'] } },
            },
          },
        ]);
        const before = manager.splits()[0]!;
        const metadataBefore = before.content.entryMetadata;

        manager.reconcile([
          {
            type: 'component',
            id: 'documents',
            entryMetadata: {
              route: { matches: [{ id: 'drive', params: {} }] },
              search: { drive: { tags: ['one'] } },
            },
          },
        ]);

        expect(manager.splits()[0]).toBe(before);
        expect(manager.splits()[0]?.content.entryMetadata).toBe(metadataBefore);

        dispose();
      });
    });

    it('updates the current entry without remounting or emitting content changes', () => {
      createRoot((dispose) => {
        const orchestrator = createMockOrchestrator();
        const manager = createSplitLayout(orchestrator, [
          {
            type: 'md',
            id: 'doc-1',
            entryMetadata: { source: 'initial' },
          },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        const initialHistoryLength = split.history().length;
        const listener = vi.fn();
        split.registerContentChangeListener(listener);

        split.updateCurrentEntry((current) => ({
          ...current,
          entryMetadata: { source: 'updated' },
        }));

        expect(split.history()).toHaveLength(initialHistoryLength);
        expect(split.content().entryMetadata).toEqual({
          source: 'updated',
        });
        expect(split.history().at(-1)?.entryMetadata).toEqual(
          split.content().entryMetadata
        );
        expect(orchestrator.createBlockInstance).toHaveBeenCalledOnce();
        expect(listener).not.toHaveBeenCalled();

        dispose();
      });
    });

    it('applies inbound metadata to same-identity content only', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          {
            type: 'component',
            id: 'documents',
            params: { privateParam: 'retained' },
            state: { privateState: 'retained' },
            entryMetadata: { source: 'initial' },
          },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        const mountBefore = manager.splits()[0].mount;
        const listener = vi.fn();
        split.registerContentChangeListener(listener);

        manager.reconcile([
          {
            type: 'component',
            id: 'documents',
            params: { privateParam: 'ignored' },
            state: { privateState: 'ignored' },
            entryMetadata: { source: 'inbound' },
          },
        ]);

        expect(split.content()).toEqual({
          type: 'component',
          id: 'documents',
          params: { privateParam: 'retained' },
          state: { privateState: 'retained' },
          entryMetadata: { source: 'inbound' },
        });
        expect(split.history().at(-1)).toEqual(split.content());
        expect(manager.splits()[0].mount).toBe(mountBefore);
        expect(listener).not.toHaveBeenCalled();

        dispose();
      });
    });

    it('restores metadata with the containing split-history entry', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'md', id: 'doc-1' },
        ]);
        const split = manager.getSplit(manager.splits()[0].id)!;
        split.updateCurrentEntry((current) => ({
          ...current,
          entryMetadata: { source: 'first-entry' },
        }));

        split.replace({
          next: {
            type: 'md',
            id: 'doc-2',
            entryMetadata: { source: 'second-entry' },
          },
        });
        split.goBack();

        expect(split.content().entryMetadata).toEqual({
          source: 'first-entry',
        });
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

    it.each(['split', 'inline'] as const)(
      'back and forward skip content owned by another %s without focusing it',
      (owner) => {
        createRoot((dispose) => {
          const manager = createSplitLayout(createMockOrchestrator(), [
            { type: 'component', id: 'inbox' },
          ]);
          const handle = manager.getSplit(manager.splits()[0].id)!;
          const occupied = { type: 'email', id: 'occupied' } as const;
          handle.replace({ next: occupied });
          handle.replace({ next: { type: 'channel', id: 'end' } });
          const activate = vi.fn();
          const release =
            owner === 'inline'
              ? manager.registerOpenViews(() => [
                  { owner: 'detail', content: occupied, activate },
                ])
              : (() => {
                  const split = manager.createNewSplit({
                    content: occupied,
                    referredFrom: null,
                  })!;
                  return () => manager.removeSplit(split.id);
                })();
          handle.activate();
          vi.mocked(toast.alert).mockClear();

          expect(handle.canGoBack()).toBe(true);
          handle.goBack();
          expect(handle.content().id).toBe('inbox');
          expect(handle.canGoBack()).toBe(false);
          expect(handle.canGoForward()).toBe(true);
          handle.goForward();
          expect(handle.content().id).toBe('end');
          expect(handle.canGoForward()).toBe(false);
          expect(handle.history().map((entry) => entry.id)).toEqual([
            'inbox',
            'occupied',
            'end',
          ]);
          expect(manager.activeSplitId()).toBe(handle.id);
          expect(activate).not.toHaveBeenCalled();
          expect(toast.alert).not.toHaveBeenCalled();

          release();
          handle.goBack();
          expect(handle.content().id).toBe('occupied');
          dispose();
        });
      }
    );

    it('disables history directions with only occupied entries and restores them when released', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'email', id: 'before' },
        ]);
        const handle = manager.getSplit(manager.splits()[0].id)!;
        handle.replace({ next: { type: 'component', id: 'inbox' } });
        handle.replace({ next: { type: 'email', id: 'after' } });
        handle.goBack();
        const canGoBack = createMemo(handle.canGoBack);
        const canGoForward = createMemo(handle.canGoForward);
        expect(canGoBack()).toBe(true);
        expect(canGoForward()).toBe(true);
        const [occupied, setOccupied] = createSignal(['before', 'after']);
        const release = manager.registerOpenViews(() =>
          occupied().map((id) => ({
            owner: id,
            content: { type: 'email', id },
          }))
        );
        expect(canGoBack()).toBe(false);
        expect(canGoForward()).toBe(false);
        handle.goBack();
        handle.goForward();
        expect(handle.content().id).toBe('inbox');
        setOccupied([]);
        expect(canGoBack()).toBe(true);
        expect(canGoForward()).toBe(true);
        setOccupied(['before', 'after']);
        expect(canGoBack()).toBe(false);
        expect(canGoForward()).toBe(false);
        release();
        expect(canGoBack()).toBe(true);
        expect(canGoForward()).toBe(true);
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
        expect(manager.activeSplitId()).toBe(inserted.split?.id);

        dispose();
      });
    });
  });

  describe('activation invariant', () => {
    it.each(['foreground', 'background'] as const)(
      'reuses the mobile %s conversation across Agents routes and blocks',
      (position) => {
        const route: SplitContent = {
          type: 'component',
          id: agentsRouteId({
            mode: 'chat',
            conversation: { type: 'chat', id: 'conversation' },
          }),
        };
        const block: SplitContent = { type: 'chat', id: 'conversation' };
        for (const [initial, target] of [
          [route, block],
          [block, route],
          [block, block],
        ]) {
          createRoot((dispose) => {
            const manager = createSplitLayout(createMockOrchestrator(), [
              position === 'foreground'
                ? { type: 'component', id: 'inbox' }
                : initial,
            ]);
            const swipe = createMobileSwipeLayout(manager);
            manager.openWithSplit(
              position === 'foreground'
                ? initial
                : { type: 'component', id: 'inbox' }
            );
            const owner = manager.findOpenView(target)!.topLevelSplit!;
            const mount = manager
              .splits()
              .find((split) => split.id === owner.id)!.mount;
            const ids = manager.splits().map((split) => split.id);
            vi.mocked(toast.alert).mockClear();

            manager.openWithSplit(target);

            expect(manager.activeSplitId()).toBe(owner.id);
            expect(manager.splits().map((split) => split.id)).toEqual(ids);
            expect(
              manager.splits().find((split) => split.id === owner.id)!.mount
            ).toBe(mount);
            expect(swipe.slotASplitId()).not.toBe(swipe.slotBSplitId());
            expect(swipe.canGoBack()).toBe(true);
            expect(toast.alert).not.toHaveBeenCalled();
            swipe.swipeBack();
            expect(
              manager.getSplit(manager.activeSplitId()!)!.content().id
            ).toBe('inbox');
            dispose();
          });
        }
      }
    );

    it('reports reuse when mobile navigation promotes an existing pane', () => {
      createRoot((dispose) => {
        const content = { type: 'email', id: 'background' } as const;
        const manager = createSplitLayout(createMockOrchestrator(), [content]);
        const owner = manager.splits()[0].id;
        createMobileSwipeLayout(manager);
        manager.openWithSplit({ type: 'email', id: 'foreground' });
        vi.mocked(toast.alert).mockClear();
        const result = manager.openWithSplit(content);
        expect(result).toMatchObject({
          status: 'reused',
          owner,
          split: { id: owner },
        });
        expect(manager.activeSplitId()).toBe(owner);
        expect(manager.splits()).toHaveLength(2);
        expect(toast.alert).not.toHaveBeenCalled();
        dispose();
      });
    });

    it.each(['refused', 'reused'] as const)(
      'preserves mobile slots when creation is %s',
      (result) => {
        createRoot((dispose) => {
          const manager = createSplitLayout(createMockOrchestrator(), [
            { type: 'component', id: 'inbox' },
          ]);
          const swipe = createMobileSwipeLayout(manager);
          manager.openWithSplit({ type: 'email', id: 'foreground' });
          const foreground = manager.getSplit(manager.activeSplitId()!)!;
          const ids = manager.splits().map((split) => split.id);
          const slots = [
            swipe.slotASplitId(),
            swipe.slotBSplitId(),
            swipe.fgIsSlotA(),
          ];
          const animate = vi.fn();
          swipe.setForwardNavigationTrigger(animate);
          vi.spyOn(manager, 'createNewSplit').mockReturnValueOnce(
            result === 'reused' ? foreground : undefined
          );
          expect(
            manager.openWithSplit({ type: 'email', id: 'next' })
          ).toMatchObject({ status: 'unavailable' });
          expect(manager.splits().map((split) => split.id)).toEqual(ids);
          expect([
            swipe.slotASplitId(),
            swipe.slotBSplitId(),
            swipe.fgIsSlotA(),
          ]).toEqual(slots);
          expect(manager.activeSplitId()).toBe(foreground.id);
          expect(animate).not.toHaveBeenCalled();
          dispose();
        });
      }
    );

    it('promotes an occupied mobile background when direct replacement is refused', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'email', id: 'background' },
        ]);
        const owner = manager.splits()[0].id;
        const swipe = createMobileSwipeLayout(manager);
        manager.openWithSplit({ type: 'email', id: 'foreground' });
        const source = manager.getSplit(manager.activeSplitId()!)!;
        source.replace({ next: { type: 'email', id: 'background' } });
        expect(manager.activeSplitId()).toBe(owner);
        expect(source.content().id).toBe('foreground');
        expect(manager.splits()).toHaveLength(2);
        expect(swipe.slotASplitId()).not.toBe(swipe.slotBSplitId());
        dispose();
      });
    });

    it('skips already-mounted history when rebuilding the mobile background', () => {
      createRoot((dispose) => {
        const manager = createSplitLayout(createMockOrchestrator(), [
          { type: 'component', id: 'inbox' },
        ]);
        const handle = manager.getSplit(manager.splits()[0].id)!;
        handle.replace({ next: { type: 'chat', id: 'conversation' } });
        handle.replace({ next: { type: 'chat', id: 'conversation' } });
        const swipe = createMobileSwipeLayout(manager);
        manager.openWithSplit({ type: 'email', id: 'next' });
        vi.mocked(toast.alert).mockClear();
        swipe.swipeBack();
        expect(manager.activeSplitId()).toBe(handle.id);
        expect(swipe.slotASplitId()).not.toBe(swipe.slotBSplitId());
        expect(manager.splits().map((split) => split.content.id)).toEqual([
          'conversation',
          'inbox',
        ]);
        expect(toast.alert).not.toHaveBeenCalled();
        swipe.swipeBack();
        expect(manager.getSplit(manager.activeSplitId()!)!.content().id).toBe(
          'inbox'
        );
        dispose();
      });
    });

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
