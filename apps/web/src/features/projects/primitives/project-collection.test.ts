import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectRow, ProjectsSource } from '../context/projects-context';
import type { ProjectFilters } from '../core/project';
import { createProjectCollection } from './project-collection';

describe('project collection', () => {
  it('passes filters to the source and follows the current assignee identity', () => {
    createRoot((dispose) => {
      const [userId, setUserId] = createSignal('first-user');
      let filters: () => ProjectFilters = () => ({});
      const collection = createProjectCollection({
        userId,
        createSource: (input = () => ({})) => {
          filters = input;
          return emptySource();
        },
      });
      collection.setMine(true);
      collection.setStatus('status-option');
      collection.setPriority('priority-option');
      collection.setDueBefore('2026-10-04');
      collection.setSort('due');
      expect(filters()).toMatchObject({
        status: 'status-option',
        priority: 'priority-option',
        assignee: 'first-user',
        sort: 'due',
        descending: false,
        dueBefore: new Date('2026-10-04T23:59:59.999').toISOString(),
      });
      setUserId('next-user');
      expect(filters().assignee).toBe('next-user');
      collection.setMine(false);
      collection.setStatus('');
      collection.setPriority('');
      collection.setDueBefore('');
      expect(filters()).toMatchObject({
        assignee: undefined,
        status: undefined,
        priority: undefined,
        dueBefore: undefined,
      });
      dispose();
    });
  });

  it('distinguishes initial failure from a failed refresh with usable rows', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<readonly ProjectRow[]>();
      const [error, setError] = createSignal<Error>();
      const collection = createProjectCollection({
        userId: () => 'user',
        createSource: () => ({ ...emptySource(), rows, error }),
      });
      expect(collection.state().kind).toBe('loading');
      const failure = new Error('offline');
      setError(failure);
      expect(collection.state()).toEqual({ kind: 'error', error: failure });
      const loaded = [
        {
          project: {
            id: 'project',
            name: 'Release',
            descriptionDocumentId: 'description',
            updatedAt: '',
          },
          properties: [],
        },
      ];
      setRows(loaded);
      expect(collection.state()).toEqual({
        kind: 'ready',
        rows: loaded,
        backgroundError: failure,
      });
      expect(collection.groups()).toEqual([
        {
          id: '',
          label: 'No status',
          count: 1,
          entities: loaded.map((row) => ({
            ...row,
            id: row.project.id,
            type: 'initiative',
          })),
        },
      ]);
      dispose();
    });
  });

  it('uses unified disclosure, activation, selection and pagination without treating initiatives as folders', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<readonly ProjectRow[]>([
        row('one'),
        row('two'),
      ]);
      const loadMore = vi.fn(async () => {});
      const open = vi.fn();
      const collection = createProjectCollection({
        userId: () => 'user',
        onOpen: open,
        createSource: () => ({
          ...emptySource(),
          rows,
          hasMore: () => true,
          loadMore,
        }),
      });
      const entities = () =>
        collection.items().filter((item) => item.kind === 'entity');
      const first = entities()[0];
      const second = entities()[1];
      if (first.kind !== 'entity' || second.kind !== 'entity')
        throw new Error('missing rows');
      expect(first.entity.type).toBe('initiative');
      collection.list.selection.selectRange(first.id, second.id);
      expect(collection.list.selection.count()).toBe(2);
      collection.list.activate.key(first.id, { metadata: { newSplit: true } });
      expect(open).toHaveBeenCalledWith('one', { newSplit: true });
      const group = collection
        .items()
        .find((item) => item.kind === 'group-header');
      if (!group || group.kind !== 'group-header')
        throw new Error('missing group');
      collection.list.activate.key(group.id);
      expect(entities()).toHaveLength(0);
      collection.list.activate.key(group.id);
      expect(entities()).toHaveLength(2);
      expect(collection.list.selection.isSelected(first.id)).toBe(true);
      const more = collection.items().find((item) => item.kind === 'load-more');
      if (!more) throw new Error('missing continuation');
      collection.list.activate.key(more.id);
      expect(loadMore).toHaveBeenCalledOnce();
      setRows([row('two'), row('three'), row('two')]);
      expect(entities()).toHaveLength(2);
      expect(
        collection.list.selection
          .items()
          .flatMap((item) => (item.kind === 'entity' ? [item.entity.id] : []))
      ).toEqual(['two']);
      collection.setGroupBy('none');
      expect(
        collection.items().some((item) => item.kind === 'group-header')
      ).toBe(false);
      dispose();
    });
  });
});

function row(id: string): ProjectRow {
  return {
    project: {
      id,
      name: id,
      descriptionDocumentId: `description-${id}`,
      updatedAt: '',
    },
    properties: [],
  };
}

function emptySource(): ProjectsSource {
  return {
    rows: () => undefined,
    loading: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadingMore: () => false,
    loadMore: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  };
}
