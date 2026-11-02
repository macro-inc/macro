import type { EntityItem } from '@core/context/quickAccess';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useEntityMention, useEntityMentionFromList } from './useEntityMention';

const list = vi.hoisted(() => ({
  items: vi.fn<() => EntityItem[]>(() => []),
  totalCount: () => 50,
  hasMore: () => true,
  isLoading: () => false,
  isLoadingMore: () => true,
  loadMore: vi.fn(),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => list,
    usesRecordSelection: () => false,
    usesSearchProjection: () => true,
    isLoading: () => false,
  }),
}));

it('exposes pagination from search projections, not just legacy record selection', async () => {
  const { mention, dispose } = createRoot((dispose) => ({
    mention: useEntityMention({ buckets: ['note'], searchTerm: () => '' }),
    dispose,
  }));
  expect(mention.hasMore()).toBe(true);
  expect(mention.isLoadingMore()).toBe(true);
  await mention.loadMore();
  expect(list.loadMore).toHaveBeenCalledOnce();
  dispose();
});

it('ranks local projects together with cached hits and reranks new pages', () => {
  const recentTask: EntityItem = {
    id: 'task',
    kind: 'entity',
    bucket: 'task',
    searchText: 'Track task changes',
    sortTimestamp: Date.now(),
    timestamps: { viewedAt: new Date() },
    data: {
      id: 'task',
      name: 'Track task changes',
      type: 'document',
      ownerId: 'owner',
      fileType: 'md',
      subType: { type: 'task' },
    },
  };
  const project: EntityItem = {
    id: 'project',
    kind: 'entity',
    bucket: 'initiative',
    searchText: 'Task planning',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      id: 'project',
      name: 'Task planning',
      type: 'initiative',
      ownerId: 'owner',
    },
  };
  const exactTask: EntityItem = {
    ...recentTask,
    id: 'exact',
    searchText: 'Task',
    data: { ...recentTask.data, id: 'exact', name: 'Task' },
  };
  const [rows, setRows] = createSignal([recentTask, project]);
  list.items.mockImplementation(rows);
  const { mention, custom, dispose } = createRoot((dispose) => ({
    mention: useEntityMention({
      buckets: ['task', 'initiative'],
      searchTerm: () => 'task',
    }),
    custom: useEntityMentionFromList({
      items: rows,
      buckets: ['task', 'initiative'],
      searchTerm: () => 'task',
    }),
    dispose,
  }));
  try {
    expect(mention.entities()).toEqual([project, recentTask]);
    expect(custom.entities()).toEqual([project, recentTask]);
    setRows([recentTask, project, exactTask]);
    expect(mention.entities()).toEqual([exactTask, project, recentTask]);
    expect(custom.entities()).toEqual([exactTask, project, recentTask]);
    expect(mention.hasMore()).toBe(true);
  } finally {
    dispose();
    list.items.mockReturnValue([]);
  }
});
