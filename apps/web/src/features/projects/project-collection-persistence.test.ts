import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createProjectCollection } from './primitives/project-collection';
import { createProjectCollectionPersistence } from './project-collection-persistence';

it('restores collection grouping, filters, collapsed groups, focus and scroll after the split captures inline navigation', () => {
  let captured: Record<string, unknown> = {};
  const captors = new Map<string, () => unknown>();
  const handle = {
    currentEntryState: () => captured,
    registerEntryStateCaptor: (key: string, read: () => unknown) => {
      captors.set(key, read);
      return () => {
        if (captors.get(key) === read) captors.delete(key);
      };
    },
  };
  const mount = () =>
    createRoot((dispose) => ({
      dispose,
      collection: createProjectCollection({
        ...createProjectCollectionPersistence(handle),
        userId: () => 'user',
        createSource: () => ({
          rows: () => [
            {
              project: {
                id: 'one',
                name: 'One',
                descriptionDocumentId: 'doc',
                updatedAt: '',
              },
              properties: [],
            },
          ],
          loading: () => false,
          error: () => undefined,
          hasMore: () => false,
          loadingMore: () => false,
          loadMore: vi.fn(async () => {}),
          refresh: vi.fn(async () => {}),
        }),
      }),
    }));
  const first = mount();
  first.collection.setGroupBy('priority');
  first.collection.setMine(true);
  first.collection.setStatus('active');
  first.collection.setPriority('high');
  first.collection.setDueBefore('2026-10-01');
  first.collection.setDueAfter('2026-09-01');
  first.collection.setSearch('launch');
  first.collection.setSort('due');
  first.collection.setScrollOffset(300);
  const header = first.collection
    .items()
    .find((item) => item.kind === 'group-header')!;
  first.collection.list.focus.set(header.id);
  first.collection.disclosure.collapse('');
  captured = Object.fromEntries(
    [...captors].map(([key, read]) => [key, read()])
  );
  first.dispose();
  const second = mount();
  expect(second.collection.groupBy()).toBe('priority');
  expect(second.collection.mine()).toBe(true);
  expect(second.collection.status()).toBe('active');
  expect(second.collection.priority()).toBe('high');
  expect(second.collection.dueBefore()).toBe('2026-10-01');
  expect(second.collection.dueAfter()).toBe('2026-09-01');
  expect(second.collection.search()).toBe('launch');
  expect(second.collection.sort()).toBe('due');
  expect(second.collection.scrollOffset()).toBe(300);
  expect(second.collection.disclosure.isExpanded('')).toBe(false);
  expect(second.collection.list.focus.key()).toBe(header.id);
  second.dispose();
  expect(captors.size).toBe(0);
});
