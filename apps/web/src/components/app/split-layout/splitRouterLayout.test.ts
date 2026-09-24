// @vitest-environment node

import {
  createRoutesManifest,
  type SplitRouterEntry,
} from '@app/lib/split-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  SplitContent,
  SplitHandle,
  SplitId,
  SplitManager,
} from './layoutManager';
import { resolveContentEntry } from './split-router/legacy-route';
import { createAppSplitRouterLayout } from './splitRouterLayout';

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));

const routes = createRoutesManifest({
  definitions: [{ id: 'drive', path: 'drive' }],
});
const location = {
  route: { matches: [{ id: 'drive', params: {} }] as const },
};

function createManager(initial: SplitContent) {
  const splitId = 'split-1' as SplitId;
  let content = initial;
  const captureEntryState = vi.fn();
  const handle = {
    content: () => content,
    captureEntryState,
    updateCurrentEntry(update: (current: SplitContent) => SplitContent) {
      content = update(content);
    },
    activate: vi.fn(),
  } as unknown as SplitHandle;
  const manager = {
    getVisibleSplits: () => [{ id: splitId, content }],
    getSplit: (id: SplitId) => (id === splitId ? handle : undefined),
    reconcile(entries: SplitContent[]) {
      content = entries[0]!;
    },
    openWithSplit: vi.fn(),
  } as unknown as SplitManager;

  return {
    manager,
    splitId,
    handle,
    content: () => content,
    captureEntryState,
  };
}

describe('app split router layout', () => {
  it('preserves router metadata separately from runtime SplitContent state', () => {
    const runtimeState = { editor: { selection: 3 } };
    const fixture = createManager({
      type: 'component',
      id: 'documents',
      state: runtimeState,
    });
    const layout = createAppSplitRouterLayout(fixture.manager, routes);
    const entry: SplitRouterEntry = {
      key: 'entry-1',
      location,
      state: { feature: { trail: ['document-1'] } },
    };

    layout.reconcile([entry]);

    expect(fixture.content().state).toBe(runtimeState);
    expect(fixture.content().entryMetadata).toEqual(entry);
    expect(layout.snapshot().entries[0]).toEqual({
      splitId: fixture.splitId,
      ...entry,
    });

    layout.updateCurrentEntry(fixture.splitId, (current) => ({
      ...current,
      key: 'entry-2',
      state: { feature: { trail: ['document-2'] } },
    }));

    expect(fixture.captureEntryState).not.toHaveBeenCalled();
    expect(fixture.content().state).toBe(runtimeState);
    expect(resolveContentEntry(routes, fixture.content())).toMatchObject({
      key: 'entry-2',
      state: { feature: { trail: ['document-2'] } },
    });
  });

  it('accepts legacy location-only entry metadata', () => {
    const content: SplitContent = {
      type: 'component',
      id: 'documents',
      entryMetadata: location,
    };

    expect(resolveContentEntry(routes, content)).toEqual({ location });
  });
});
