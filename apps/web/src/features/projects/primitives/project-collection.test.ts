import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { PendingProject, ProjectRow } from '../context/projects-context';
import type { ProjectFilters } from '../core/project';
import { emptySource, noPendingProjects } from '../tests/fixtures';
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
        createPendingSource: noPendingProjects,
      });
      collection.setMine(true);
      collection.setStatus('status-option');
      collection.setPriority('priority-option');
      collection.setDueBefore('2026-10-04');
      collection.setSort('created');
      expect(filters()).toMatchObject({
        status: 'status-option',
        priority: 'priority-option',
        assignee: 'first-user',
        sort: 'created',
        descending: true,
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
        createPendingSource: noPendingProjects,
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
        createPendingSource: noPendingProjects,
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

  it('leads with a pending project, then hands it to its server row without a duplicate', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<readonly ProjectRow[]>([
        row('older'),
      ]);
      const [pending, setPending] = createSignal<readonly PendingProject[]>([
        pendingProject('pending-project-1', 'creating', 'in-progress'),
      ]);
      const open = vi.fn();
      const collection = createProjectCollection({
        userId: () => 'user',
        onOpen: open,
        createSource: () => ({ ...emptySource(), rows }),
        createPendingSource: () => ({ projects: pending }),
      });
      const shown = () =>
        collection.items().flatMap((item) =>
          item.kind === 'entity'
            ? [
                {
                  id: item.entity.id,
                  pending: item.entity.pending ?? false,
                  drafted: item.entity.properties.length > 0,
                },
              ]
            : []
        );
      const entityKey = (id: string) =>
        collection
          .items()
          .find((item) => item.kind === 'entity' && item.entity.id === id)!.id;
      // Grouped by status, it joins the group its drafted status belongs to.
      expect(
        collection.groups().map((group) => [group.id, group.count])
      ).toEqual([
        ['in-progress', 1],
        ['', 1],
      ]);
      collection.setGroupBy('none');
      expect(shown()).toEqual([
        { id: 'pending-project-1', pending: 'creating', drafted: true },
        { id: 'older', pending: false, drafted: false },
      ]);
      // It may not exist yet, so it can be neither opened nor batch-selected.
      collection.list.activate.key(entityKey('pending-project-1'));
      collection.list.selection.select(entityKey('pending-project-1'));
      expect(open).not.toHaveBeenCalled();
      expect(collection.list.selection.count()).toBe(0);
      // Created while its properties save: a list refreshed meanwhile returns
      // it without them, and the saving row keeps its drafted values.
      setPending([pendingProject('created', 'saving', 'in-progress')]);
      setRows([row('created'), row('older')]);
      expect(shown()).toEqual([
        { id: 'created', pending: 'created', drafted: true },
        { id: 'older', pending: false, drafted: false },
      ]);
      collection.list.activate.key(entityKey('created'));
      expect(open).toHaveBeenCalledWith('created', undefined);
      // Saved: the server row now takes precedence.
      setPending([pendingProject('created', 'saved', 'in-progress')]);
      expect(shown()).toEqual([
        { id: 'created', pending: false, drafted: false },
        { id: 'older', pending: false, drafted: false },
      ]);
      setPending([]);
      expect(shown()).toEqual([
        { id: 'created', pending: false, drafted: false },
        { id: 'older', pending: false, drafted: false },
      ]);
      dispose();
    });
  });

  it('keeps a saved project listed until a refresh includes it', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<readonly ProjectRow[]>([
        row('older'),
      ]);
      const collection = createProjectCollection({
        userId: () => 'user',
        createSource: () => ({ ...emptySource(), rows }),
        createPendingSource: () => ({
          projects: () => [pendingProject('created', 'saved')],
        }),
      });
      collection.setGroupBy('none');
      const ids = () =>
        collection
          .items()
          .flatMap((item) => (item.kind === 'entity' ? [item.entity.id] : []));
      expect(ids()).toEqual(['created', 'older']);
      setRows([row('created'), row('older')]);
      expect(ids()).toEqual(['created', 'older']);
      dispose();
    });
  });

  it('drops a failed pending project without touching the server rows', () => {
    createRoot((dispose) => {
      const loaded = [row('older')];
      const [pending, setPending] = createSignal<readonly PendingProject[]>([
        pendingProject('pending-project-1', 'creating'),
      ]);
      const collection = createProjectCollection({
        userId: () => 'user',
        createSource: () => ({ ...emptySource(), rows: () => loaded }),
        createPendingSource: () => ({ projects: pending }),
      });
      const state = collection.state();
      expect(state.kind === 'ready' && state.rows).toHaveLength(2);
      setPending([]);
      expect(collection.state()).toEqual({
        kind: 'ready',
        rows: loaded,
        backgroundError: undefined,
      });
      dispose();
    });
  });

  it('shows a pending project only under filters that would keep it', () => {
    createRoot((dispose) => {
      const collection = createProjectCollection({
        userId: () => 'user',
        createSource: () => ({ ...emptySource(), rows: () => [] }),
        createPendingSource: () => ({
          projects: () => [
            pendingProject('pending', 'creating', 'in-progress'),
          ],
        }),
      });
      const count = () => {
        const state = collection.state();
        return state.kind === 'ready' ? state.rows.length : 0;
      };
      expect(count()).toBe(1);
      collection.setStatus('completed');
      expect(count()).toBe(0);
      collection.setStatus('in-progress');
      expect(count()).toBe(1);
      collection.setMine(true);
      expect(count()).toBe(0);
      collection.setMine(false);
      collection.setDueAfter('2026-10-01');
      expect(count()).toBe(0);
      dispose();
    });
  });
});

const status: Property = {
  propertyId: SYSTEM_PROPERTY_IDS.STATUS,
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
  displayName: 'Status',
  valueType: 'SELECT_STRING',
  value: null,
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
};

function pendingProject(
  id: string,
  phase: PendingProject['phase'],
  statusOption?: string
): PendingProject {
  return {
    id,
    name: `Project ${id}`,
    submittedAt: '2026-09-29T12:00:00.000Z',
    phase,
    properties: statusOption
      ? [
          {
            property: status,
            value: { valueType: 'SELECT_STRING', values: [statusOption] },
          },
        ]
      : [],
  };
}

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
