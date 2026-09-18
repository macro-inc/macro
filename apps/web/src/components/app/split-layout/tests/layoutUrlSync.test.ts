import { agentsRouteId } from '@app/features/agents-view/core/route';
import { createContentInstanceRegistry } from '@core/contentInstanceRegistry';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { Navigator } from '@solidjs/router';
import { batch, createMemo, createRoot, createSignal } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSplitLayout, type SplitContent } from '../layoutManager';
import { createLayoutUrlSync } from '../layoutUrlSync';
import {
  loadRestorablePreviewLayout,
  type PreviewQueryValue,
} from '../previewPersistence';

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
  } as unknown as BlockOrchestrator;
}

type HarnessOptions = {
  managerContent: SplitContent[];
  urlSegments: string[];
  previewQuery?: PreviewQueryValue;
  search?: string;
  hash?: string;
};

function createHarness(options: HarnessOptions) {
  const navigate = vi.fn();

  return createRoot((dispose) => {
    const manager = createSplitLayout(
      createMockOrchestrator(),
      options.managerContent
    );
    const [pairs, setPairs] = createSignal(options.urlSegments);
    const [previewQuery, setPreviewQuery] = createSignal<PreviewQueryValue>(
      options.previewQuery
    );
    const [search, setSearch] = createSignal(options.search ?? '');
    const [hash, setHash] = createSignal(options.hash ?? '');
    const decodedLayout = createMemo(() =>
      loadRestorablePreviewLayout(pairs(), previewQuery())
    );

    createLayoutUrlSync(manager, pairs, previewQuery, decodedLayout, {
      navigate: navigate as Navigator,
      search,
      hash,
    });

    return {
      manager,
      navigate,
      dispose,
      setUrl(
        segments: string[],
        preview: PreviewQueryValue,
        nextSearch = '',
        nextHash = ''
      ) {
        batch(() => {
          setPairs(segments);
          setPreviewQuery(preview);
          setSearch(nextSearch);
          setHash(nextHash);
        });
      },
    };
  });
}

async function flushUrlSync() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('layout URL synchronization', () => {
  it('navigates between Agents conversations and restores browser back/forward paths', async () => {
    const chat = {
      type: 'component' as const,
      id: agentsRouteId({
        mode: 'chat',
        conversation: { type: 'agent_session', id: 'session-1' },
      }),
    };
    const code = {
      type: 'component' as const,
      id: agentsRouteId({
        mode: 'code',
        conversation: { type: 'agent_session', id: 'session-2' },
      }),
    };
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'agents' }],
      urlSegments: ['component', 'agents'],
    });
    await flushUrlSync();
    const handle = harness.manager.getSplit(harness.manager.splits()[0].id)!;
    handle.replace({ next: chat });
    await flushUrlSync();
    expect(harness.navigate).toHaveBeenLastCalledWith('/agents/session-1', {
      replace: false,
    });
    harness.setUrl(['agents', 'session-1'], undefined);
    await flushUrlSync();
    handle.replace({ next: code });
    await flushUrlSync();
    expect(harness.navigate).toHaveBeenLastCalledWith('/coders/session-2', {
      replace: false,
    });
    harness.setUrl(['coders', 'session-2'], undefined);
    await flushUrlSync();
    harness.setUrl(['agents', 'session-1'], undefined);
    await flushUrlSync();
    expect(harness.manager.splits()[0].content).toEqual(chat);
    harness.setUrl(['coders', 'session-2'], undefined);
    await flushUrlSync();
    expect(harness.manager.splits()[0].content).toEqual(code);
    harness.dispose();
  });

  it('replaces a pending workspace URL with the real session without remounting', async () => {
    const pendingId = agentsRouteId({
      mode: 'chat',
      conversation: { type: 'agent_session', id: 'pending-1' },
    });
    const resolvedId = agentsRouteId({
      mode: 'chat',
      conversation: { type: 'agent_session', id: 'session-1' },
    });
    const harness = createHarness({
      managerContent: [{ type: 'component', id: pendingId }],
      urlSegments: ['agents', 'pending-1'],
    });
    await flushUrlSync();
    const split = harness.manager.splits()[0];
    const mount = split.mount;
    const handle = harness.manager.getSplit(split.id)!;
    const historyLength = handle.history().length;
    handle.adoptContentId({ type: 'component', nextId: resolvedId });
    await flushUrlSync();
    expect(harness.navigate).toHaveBeenLastCalledWith('/agents/session-1', {
      replace: true,
    });
    expect(harness.manager.splits()[0].mount).toBe(mount);
    expect(handle.history()).toHaveLength(historyLength);
    expect(handle.history().at(-1)?.id).toBe(resolvedId);
    harness.dispose();
  });

  it('restores Agents deep links next to another split', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'agents' }],
      urlSegments: ['md', 'document-1', 'coders', 'session-2'],
    });
    await flushUrlSync();
    expect(harness.manager.getUrlSegments()).toEqual([
      'md',
      'document-1',
      'coders',
      'session-2',
    ]);
    expect(harness.manager.splits()[1].content.id).toBe(
      agentsRouteId({
        mode: 'code',
        conversation: { type: 'agent_session', id: 'session-2' },
      })
    );
    harness.dispose();
  });

  it('coalesces preview engagement into one canonical manager-to-URL update', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'inbox' }],
      urlSegments: ['component', 'inbox'],
    });

    await flushUrlSync();
    harness.navigate.mockClear();
    harness.manager.engagePreviewMode(harness.manager.splits()[0].id);
    await flushUrlSync();

    expect(harness.navigate).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith(
      `/${harness.manager.getUrlSegments().join('/')}?preview=0`,
      { replace: false }
    );

    harness.dispose();
  });

  it('preserves unrelated query and hash state for a query-only update', async () => {
    const harness = createHarness({
      managerContent: [
        { type: 'component', id: 'inbox' },
        { type: 'component', id: 'preview-empty' },
      ],
      urlSegments: ['component', 'inbox', 'component', 'preview-empty'],
      search: '?keep=value',
      hash: '#selection',
    });

    await flushUrlSync();
    harness.navigate.mockClear();
    harness.manager.engagePreviewMode(harness.manager.splits()[0].id);
    await flushUrlSync();

    expect(harness.navigate).toHaveBeenCalledWith(
      `/${harness.manager.getUrlSegments().join('/')}?keep=value&preview=0#selection`,
      { replace: false }
    );

    harness.dispose();
  });

  it('reconciles URL path and preview state without navigating back', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'inbox' }],
      urlSegments: ['component', 'inbox'],
    });
    await flushUrlSync();
    harness.navigate.mockClear();

    harness.setUrl(['component', 'inbox', 'md', 'doc-1'], '0', '?preview=0');
    await flushUrlSync();

    const [controller, viewer] = harness.manager.splits();
    expect(controller.content).toMatchObject({
      type: 'component',
      id: 'inbox',
    });
    expect(viewer.content).toMatchObject({ type: 'md', id: 'doc-1' });
    expect(harness.manager.viewerOf(controller.id)).toBe(viewer.id);
    expect(harness.navigate).not.toHaveBeenCalled();

    harness.dispose();
  });

  it('canonicalizes invalid bare preview placeholders with replace', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'inbox' }],
      urlSegments: ['component', 'inbox', 'component', 'preview-empty'],
    });

    await flushUrlSync();

    expect(harness.navigate).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith('/component/inbox', {
      replace: true,
    });

    harness.dispose();
  });

  it('restores a Preview Pair across a settings clobber round trip', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'mail' }],
      urlSegments: ['component', 'mail'],
    });
    await flushUrlSync();

    // Engage preview and give the viewer real content, like opening an item.
    const controllerId = harness.manager.splits()[0].id;
    harness.manager.engagePreviewMode(controllerId);
    const viewerId = harness.manager.viewerOf(controllerId)!;
    harness.manager.getSplit(viewerId)!.replace({
      next: { type: 'md', id: 'doc-1' },
      mergeHistory: true,
    });
    await flushUrlSync();
    harness.setUrl(['component', 'mail', 'md', 'doc-1'], '0', '?preview=0');
    await flushUrlSync();

    // Open settings: clobber down to a lone settings split
    // (collapseToSoloSettings), then apply the URL the sync emitted.
    harness.manager.replaceAllSplits({ type: 'component', id: 'settings' });
    await flushUrlSync();
    harness.setUrl(['settings', 'account'], undefined, '');
    await flushUrlSync();

    // Close settings: navigate back to the captured return URL.
    harness.setUrl(['component', 'mail', 'md', 'doc-1'], '0', '?preview=0');
    await flushUrlSync();

    const [controller, viewer] = harness.manager.splits();
    expect(controller.content).toMatchObject({
      type: 'component',
      id: 'mail',
    });
    expect(viewer.content).toMatchObject({ type: 'md', id: 'doc-1' });
    expect(harness.manager.viewerOf(controller.id)).toBe(viewer.id);
  });

  it('uses replace navigation and clears location state for replace-caused path changes', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'inbox' }],
      urlSegments: ['component', 'inbox'],
      search: '?keep=value',
      hash: '#selection',
    });
    await flushUrlSync();
    harness.navigate.mockClear();

    const split = harness.manager.getSplit(harness.manager.splits()[0].id)!;
    split.replace({
      next: { type: 'md', id: 'doc-1' },
      mergeHistory: true,
    });
    await flushUrlSync();

    expect(harness.navigate).toHaveBeenCalledWith('/md/doc-1', {
      replace: true,
    });

    harness.dispose();
  });

  it('preserves a macrod pairing code while settings canonicalizes its tab', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'settings' }],
      urlSegments: ['settings', 'harness'],
      search: '?pair=3GTM-FNJ9&discard=value',
    });

    await flushUrlSync();

    expect(harness.navigate).not.toHaveBeenCalled();

    harness.dispose();
  });

  it('does not stall settings URL synchronization for an empty pairing code', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'settings' }],
      urlSegments: ['settings', 'harness'],
      search: '?pair=',
    });

    await flushUrlSync();

    expect(harness.navigate).toHaveBeenCalledWith('/settings/account', {
      replace: true,
    });

    harness.dispose();
  });

  it('preserves agent creation links while settings canonicalizes its tab', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'settings' }],
      urlSegments: ['settings', 'agents'],
      search: '?createAgent=true',
    });
    await flushUrlSync();
    expect(harness.navigate).not.toHaveBeenCalled();
    harness.dispose();
  });
});
