import type { UserItem } from '@core/context/quickAccess';
import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import {
  type BucketConfig,
  useMentionsMenuController,
} from './MentionsMenuController';

const items = (prefix: string, count: number): UserItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    kind: 'user',
    bucket: 'person',
    data: {
      id: `${prefix}-${index}`,
      name: prefix,
      email: `${index}@test.com`,
    },
    searchText: prefix,
    sortTimestamp: 0,
    timestamps: {},
  }));

const bucket = (id: BucketConfig['id'], data: UserItem[]): BucketConfig => ({
  id,
  label: id,
  getData: () => data,
  getFullCount: () => data.length,
});

it('keeps the same people visible and selected as delayed categories arrive', () => {
  createRoot((dispose) => {
    const people = items('person', 7);
    const [buckets, setBuckets] = createSignal([bucket('users', people)]);
    const menu = useMentionsMenuController(buckets);
    expect(menu.combinedItems()).toEqual(people.slice(0, 3));
    menu.selectItem(2);

    setBuckets([
      bucket('users', people),
      bucket('documents', items('doc', 74)),
      bucket('channels', items('channel', 24)),
      bucket('agentSessions', items('session', 3)),
      bucket('companies', items('company', 8)),
      bucket('emails', items('email', 3)),
    ]);
    expect(menu.combinedItems().slice(0, 3)).toEqual(people.slice(0, 3));
    expect(menu.selectedItem()).toBe(people[2]);
    expect(menu.selectedCategory()).toBe('users');
    expect(menu.combinedItems()).toHaveLength(8);
    dispose();
  });
});

it('keeps all people accessible through View all and keyboard navigation', () => {
  createRoot((dispose) => {
    const people = items('person', 7);
    const menu = useMentionsMenuController(() => [bucket('users', people)]);
    expect(menu.canViewAllForCategory('users')).toBe(true);
    menu.viewAll('users');
    expect(menu.combinedItems()).toEqual(people);
    menu.selectPrev();
    expect(menu.selectedItem()).toBe(people[6]);
    menu.exitViewAll();
    expect(menu.combinedItems()).toEqual(people.slice(0, 3));
    dispose();
  });
});

it('allocates unused people slots to other categories and excludes ignored people', () => {
  createRoot((dispose) => {
    const people = items('person', 2);
    const menu = useMentionsMenuController(
      () => [bucket('users', people), bucket('documents', items('doc', 20))],
      { ignoredIds: () => [people[0].id] }
    );
    expect(menu.bins()).toEqual({ users: 1, documents: 7 });
    expect(menu.combinedItems()).toHaveLength(8);
    expect(menu.combinedItems()[0]).toBe(people[1]);
    dispose();
  });
});

it('retains the full combined mobile list and entity-only allocation', () => {
  createRoot((dispose) => {
    const allItems = items('all', 12);
    const menu = useMentionsMenuController(() => [bucket('all', allItems)]);
    menu.viewAll('all');
    expect(menu.combinedItems()).toEqual(allItems);
    const entities = useMentionsMenuController(() => [
      bucket('documents', items('doc', 20)),
      bucket('channels', items('channel', 20)),
    ]);
    expect(entities.bins()).toEqual({ documents: 4, channels: 4 });
    dispose();
  });
});

it('keeps every category reachable when stable People rows exceed the preview target', () => {
  createRoot((dispose) => {
    const otherCategories: BucketConfig['id'][] = [
      'openTabs',
      'documents',
      'channels',
      'agentSessions',
      'companies',
      'emails',
      'dates',
    ];
    const menu = useMentionsMenuController(() => [
      bucket('users', items('person', 7)),
      ...otherCategories.map((id) => bucket(id, items(id, 10))),
    ]);
    expect(menu.bins().users).toBe(3);
    for (const id of otherCategories) {
      expect(menu.bins()[id]).toBe(1);
      expect(menu.canViewAllForCategory(id)).toBe(true);
    }
    expect(menu.combinedItems()).toHaveLength(10);
    dispose();
  });
});
