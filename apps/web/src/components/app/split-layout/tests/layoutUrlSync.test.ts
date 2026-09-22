import { agentsRouteId } from '@app/features/agents-view/core/route';
import { createContentInstanceRegistry } from '@core/contentInstanceRegistry';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { Navigator } from '@solidjs/router';
import { batch, createRoot, createSignal } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSplitLayout, type SplitContent } from '../layoutManager';
import { createLayoutUrlSync } from '../layoutUrlSync';

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
    const [search, setSearch] = createSignal(options.search ?? '');

    createLayoutUrlSync(manager, pairs, {
      navigate: navigate as Navigator,
      search,
    });

    return {
      manager,
      navigate,
      dispose,
      setUrl(segments: string[], nextSearch = '') {
        batch(() => {
          setPairs(segments);
          setSearch(nextSearch);
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
    harness.setUrl(['agents', 'session-1']);
    await flushUrlSync();
    handle.replace({ next: code });
    await flushUrlSync();
    expect(harness.navigate).toHaveBeenLastCalledWith('/coders/session-2', {
      replace: false,
    });
    harness.setUrl(['coders', 'session-2']);
    await flushUrlSync();
    harness.setUrl(['agents', 'session-1']);
    await flushUrlSync();
    expect(harness.manager.splits()[0].content).toEqual(chat);
    harness.setUrl(['coders', 'session-2']);
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

  it('reconciles URL paths without navigating back', async () => {
    const harness = createHarness({
      managerContent: [{ type: 'component', id: 'inbox' }],
      urlSegments: ['component', 'inbox'],
    });
    await flushUrlSync();
    harness.navigate.mockClear();

    harness.setUrl(['component', 'inbox', 'md', 'doc-1']);
    await flushUrlSync();

    const [list, detail] = harness.manager.splits();
    expect(list.content).toMatchObject({
      type: 'component',
      id: 'inbox',
    });
    expect(detail.content).toMatchObject({ type: 'md', id: 'doc-1' });
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
