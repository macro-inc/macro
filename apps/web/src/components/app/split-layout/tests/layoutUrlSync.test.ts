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
});
