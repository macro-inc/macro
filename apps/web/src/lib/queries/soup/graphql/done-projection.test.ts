import type { EmailEntity, EntityData } from '@entity/types/entity';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SoupAstItemsData } from '../items';
import { createGraphqlSoupDoneProjection } from './done-projection';
import {
  type PendingGraphqlSoupDone,
  soupDoneNotifications,
} from './optimistic-done';

// These tests exercise the display boundary, not application query setup.
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('./active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(),
}));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const createProjection = () =>
  createRoot((dispose) => {
    disposers.push(dispose);
    return createGraphqlSoupDoneProjection();
  });
const email = (id: string, done = false): EmailEntity =>
  ({ id, type: 'email', name: id, done }) as EmailEntity;
const page = (entities: EntityData[]): SoupAstItemsData => ({
  entities,
  groups: undefined,
});
const intent = (done = true): PendingGraphqlSoupDone => ({
  operation: {},
  entityIds: new Set(['a']),
  notificationIds: new Set(),
  done,
  startedAt: Date.now(),
  notificationStartedAt: Date.now(),
  scopeChannelThreads: false,
  observe: vi.fn(),
  unobserve: vi.fn(),
});
const deleted = new Set<string>();

it('changes All indicators immediately without changing the query store or other rows', () => {
  const project = createProjection();
  const source = page([email('a'), email('b')]);
  const done = intent();
  const result = project('all', source, [done], false, deleted)!;
  expect((result.entities[0] as EmailEntity).done).toBe(true);
  expect((source.entities[0] as EmailEntity).done).toBe(false);
  expect(result.entities[1]).toBe(source.entities[1]);
  expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
});

it('acknowledges raw fields, not the optimistic fields it just projected', () => {
  const project = createProjection();
  const done = intent();
  project('all', page([email('a')]), [done], false, deleted);
  expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
  project('all', page([email('a', true)]), [done], false, deleted);
  expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), true);
});

it('restores an admitted row at once on Undo after the cache removed it', () => {
  const project = createProjection();
  const before = page([email('b'), email('a'), email('c')]);
  const done = intent();
  expect(
    project('signal', before, [done], true, deleted)?.entities.map((e) => e.id)
  ).toEqual(['b', 'c']);
  const committed = page([before.entities[0], before.entities[2]]);
  project('signal', committed, [done], true, deleted);
  // Acknowledged Done can be released; the action still owns its weak snapshot.
  project('signal', committed, [], true, deleted);
  const undone = { ...done, done: false };
  const result = project('signal', committed, [undone], true, deleted)!;
  expect(result.entities.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  expect((result.entities[1] as EmailEntity).done).toBe(false);
  expect(result.entities[0]).toBe(committed.entities[0]);
  expect(undone.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
  // Another stale response must not remove the optimistic restoration.
  expect(
    project('signal', committed, [undone], true, deleted)?.entities
  ).toEqual(result.entities);
  expect(
    project('signal', committed, [done], true, deleted)?.entities.map(
      (e) => e.id
    )
  ).toEqual(['b', 'c']);
});

it('does not acknowledge an admitted row when its reader temporarily loses data', () => {
  const project = createProjection();
  const done = intent();
  project('signal', page([email('a')]), [done], true, deleted);
  project('signal', undefined, [done], true, deleted);
  expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
  const restored = project(
    'signal',
    page([]),
    [{ ...done, done: false }],
    true,
    deleted
  )!;
  expect(restored.entities.map((e) => e.id)).toEqual(['a']);
});

it('does not restore into another filter/sort scope or over a deletion', () => {
  const project = createProjection();
  const done = intent();
  project('signal', page([email('a')]), [done], true, deleted);
  const undone = { ...done, done: false };
  expect(
    project('signal', page([]), [undone], true, new Set(['a']))?.entities
  ).toEqual([]);
  expect(project('noise', page([]), [undone], true, deleted)?.entities).toEqual(
    []
  );
  // Returning to the old scope doesn't reuse snapshots across a query transition.
  expect(
    project('signal', page([]), [undone], true, deleted)?.entities
  ).toEqual([]);
});

it('restores grouped membership, count and raw pool without mutating server data', () => {
  const project = createProjection();
  const done = intent();
  const item = {
    tag: 'emailThread',
    data: { id: 'a', inboxVisible: true },
    frecency_score: 0,
  } as NonNullable<SoupAstItemsData['itemsById']>[string];
  const original: SoupAstItemsData = {
    entities: [email('a')],
    groups: [
      {
        key: 'group',
        label: 'Group',
        displayOrder: 0,
        itemIds: ['a'],
        totalCount: 1,
        nextCursor: null,
      },
    ],
    itemsById: { a: item },
  };
  project('grouped', original, [done], true, deleted);
  const committed: SoupAstItemsData = {
    entities: [],
    groups: [],
    itemsById: {},
  };
  const result = project(
    'grouped',
    committed,
    [{ ...done, done: false }],
    true,
    deleted
  )!;
  expect(result.groups).toEqual(original.groups);
  expect(result.itemsById?.a).toBe(item);
  expect(committed).toEqual({ entities: [], groups: [], itemsById: {} });
});

it('applies the newest intent and preserves untouched collection identity', () => {
  const project = createProjection();
  const source = page([email('a')]);
  expect(project('signal', source, [], true, deleted)).toBe(source);
  const old = intent();
  const latest = intent(false);
  expect(project('signal', source, [old, latest], true, deleted)).toBe(source);
  expect(old.observe).not.toHaveBeenCalled();
});

describe('notification-backed rows', () => {
  const document = (state: string): EntityData =>
    ({
      id: 'a',
      type: 'document',
      name: 'Document',
      notifications: [{ id: 'n1', state, created_at: '2020-01-01T00:00:00Z' }],
    }) as unknown as EntityData;

  it('restores only a row admitted by this notification query', () => {
    const project = createProjection();
    const done = { ...intent(), notificationIds: new Set(['n1']) };
    project('home-feed', page([document('unseen')]), [done], true, deleted);
    const undone = { ...done, done: false };
    expect(
      project('home-feed', page([]), [undone], true, deleted)?.entities
    ).toHaveLength(1);
    project('home-feed', page([document('seen')]), [undone], true, deleted);
    expect(undone.observe).toHaveBeenLastCalledWith(expect.any(Object), true);
  });

  it('retains notification witnesses when a query store clears its edge in place', () => {
    const project = createProjection();
    const done = { ...intent(), notificationIds: new Set(['n1']) };
    const [query, setQuery] = createStore({
      entities: [
        {
          id: 'a',
          type: 'document',
          name: 'Document',
          notifications: [
            { id: 'n1', state: 'unseen', created_at: '2020-01-01T00:00:00Z' },
          ],
        },
      ],
    });
    const current = () => page(query.entities as unknown as EntityData[]);
    project('home-feed', current(), [done], true, deleted);
    setQuery('entities', 0, 'notifications', []);
    project('home-feed', current(), [done], true, deleted);
    expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
    setQuery('entities', []);
    const restored = project(
      'home-feed',
      current(),
      [{ ...done, done: false }],
      true,
      deleted
    )!;
    expect(
      soupDoneNotifications(restored.entities[0], false).map((n) => n.id)
    ).toEqual(['n1']);
    expect(query.entities).toEqual([]);
  });

  it('does not acknowledge missing notification evidence while the row is still present', () => {
    const project = createProjection();
    const done = { ...intent(), notificationIds: new Set(['n1']) };
    project('home-feed', page([document('unseen')]), [done], true, deleted);
    const incomplete = {
      ...document('unseen'),
      notifications: [],
    } as unknown as EntityData;
    project('home-feed', page([incomplete]), [done], true, deleted);
    expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), false);
    project('home-feed', page([]), [done], true, deleted);
    expect(done.observe).toHaveBeenLastCalledWith(expect.any(Object), true);
  });

  it('does not redefine unfiltered Home-recents membership', () => {
    const project = createProjection();
    const source = page([document('unseen')]);
    const done = intent();
    expect(project('recents', source, [done], false, deleted)).toBe(source);
    expect(done.observe).not.toHaveBeenCalled();
  });
});
