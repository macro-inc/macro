import type { ChannelCategoryLayout } from '@service-storage/client';
import { describe, expect, it, vi } from 'vitest';

import {
  type ChannelCategoryIntent,
  ChannelCategoryMutationQueue,
  deleteCategory,
  moveCategory,
  moveChannel,
  StaleCategorySessionError,
} from './category-layout';

const layout = {
  revision: 4,
  categories: [
    { id: 'work', name: 'Work' },
    { id: 'social', name: 'Social' },
  ],
  placements: [
    { channel_id: 'one', category_id: 'work' },
    { channel_id: 'two', category_id: 'work' },
  ],
};

describe('channel category layout', () => {
  it('moves channels between categories and Uncategorized', () => {
    expect(moveChannel(layout, 'one', null).placements).toEqual([
      { channel_id: 'two', category_id: 'work' },
      { channel_id: 'one', category_id: null },
    ]);
  });

  it('keeps channels Uncategorized when deleting a category', () => {
    expect(deleteCategory(layout, 'work')).toEqual({
      revision: 4,
      categories: [{ id: 'social', name: 'Social' }],
      placements: [
        { channel_id: 'one', category_id: null },
        { channel_id: 'two', category_id: null },
      ],
    });
  });

  it('orders channels within a category at the requested position', () => {
    expect(moveChannel(layout, 'two', 'work', 0).placements).toEqual([
      { channel_id: 'two', category_id: 'work' },
      { channel_id: 'one', category_id: 'work' },
    ]);
  });

  it('reorders categories while preserving empty categories', () => {
    expect(moveCategory(layout, 'social', 0)).toEqual({
      ...layout,
      categories: [
        { id: 'social', name: 'Social' },
        { id: 'work', name: 'Work' },
      ],
    });
  });
});

const rename = (id: string, name: string): ChannelCategoryIntent => ({
  type: 'rename-category',
  categoryId: id,
  name,
});

describe('channel category mutation intent replay', () => {
  it('rejects a delayed older success after an ordinary newer refetch', async () => {
    const releases: Array<(layout: ChannelCategoryLayout) => void> = [];
    const requests: ChannelCategoryLayout[] = [];
    const changes: ChannelCategoryLayout[] = [];
    const queue = new ChannelCategoryMutationQueue(
      layout,
      (request) => {
        requests.push(request);
        return new Promise((resolve) => releases.push(resolve));
      },
      undefined,
      (next) => changes.push(next)
    );
    const first = queue.enqueue(rename('work', 'Local work'));
    const second = queue.enqueue(rename('social', 'Local friends'));
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    queue.absorbConfirmed({
      ...layout,
      revision: 6,
      categories: [
        { id: 'work', name: 'Server work' },
        { id: 'social', name: 'Server social' },
      ],
    });
    releases[0]({ ...requests[0], revision: 5 });
    await first;
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[1]).toMatchObject({
      revision: 6,
      categories: [
        { id: 'work', name: 'Server work' },
        { id: 'social', name: 'Local friends' },
      ],
    });
    expect(changes.at(-1)).toEqual(requests[1]);
    releases[1]({ ...requests[1], revision: 7 });
    await second;
  });

  it.each([6, 7])(
    'accepts an equal or newer successful revision %s',
    async (revision) => {
      const changes: ChannelCategoryLayout[] = [];
      const queue = new ChannelCategoryMutationQueue(
        layout,
        async (request) => ({ ...request, revision }),
        undefined,
        (next) => changes.push(next)
      );
      await queue.enqueue(rename('work', 'Accepted'));
      expect(queue.optimistic().revision).toBe(revision);
      expect(queue.optimistic().categories).toContainEqual({
        id: 'work',
        name: 'Accepted',
      });
      expect(changes.at(-1)).toEqual(queue.optimistic());
    }
  );

  it('absorbs an ordinary authoritative refetch and reapplies pending intents', async () => {
    let release!: (layout: ChannelCategoryLayout) => void;
    const persisted = new Promise<ChannelCategoryLayout>((resolve) => {
      release = resolve;
    });
    const changes: ChannelCategoryLayout[] = [];
    const queue = new ChannelCategoryMutationQueue(
      layout,
      () => persisted,
      undefined,
      (next) => changes.push(next)
    );
    const pending = queue.enqueue(rename('social', 'Friends'));
    queue.absorbConfirmed({
      ...layout,
      revision: 8,
      categories: [
        { id: 'work', name: 'Projects' },
        { id: 'social', name: 'Social' },
      ],
    });
    expect(changes.at(-1)).toMatchObject({
      revision: 8,
      categories: [
        { id: 'work', name: 'Projects' },
        { id: 'social', name: 'Friends' },
      ],
    });
    release({ ...changes.at(-1)!, revision: 9 });
    await pending;
  });

  it('removes failed A before persisting B', async () => {
    const requests: ChannelCategoryLayout[] = [];
    const queue = new ChannelCategoryMutationQueue(layout, async (next) => {
      requests.push(next);
      if (requests.length === 1) throw new Error('A failed');
      return { ...next, revision: next.revision + 1 };
    });
    const a = queue.enqueue({ type: 'delete-category', categoryId: 'work' });
    const b = queue.enqueue(rename('social', 'Friends'));
    await expect(a).rejects.toThrow('A failed');
    await b;
    expect(requests[1]).toMatchObject({
      revision: 4,
      categories: [
        { id: 'work', name: 'Work' },
        { id: 'social', name: 'Friends' },
      ],
    });
    expect(queue.optimistic().categories).toEqual(requests[1].categories);
  });

  it('keeps successful A when B fails', async () => {
    let calls = 0;
    const queue = new ChannelCategoryMutationQueue(layout, async (next) => {
      if (++calls === 2) throw new Error('B failed');
      return { ...next, revision: next.revision + 1 };
    });
    await queue.enqueue(rename('work', 'Projects'));
    await expect(
      queue.enqueue({ type: 'delete-category', categoryId: 'social' })
    ).rejects.toThrow('B failed');
    expect(queue.optimistic().categories).toContainEqual({
      id: 'work',
      name: 'Projects',
    });
    expect(queue.optimistic().categories).toContainEqual({
      id: 'social',
      name: 'Social',
    });
  });

  it('refetches after conflict and reapplies later pending intents', async () => {
    const authoritative = { ...layout, revision: 9 };
    const requests: ChannelCategoryLayout[] = [];
    const queue = new ChannelCategoryMutationQueue(
      layout,
      async (next) => {
        requests.push(next);
        if (requests.length === 1)
          throw Object.assign(new Error('conflict'), {
            errors: [{ code: 'CONFLICT' }],
          });
        return { ...next, revision: next.revision + 1 };
      },
      async () => authoritative
    );
    const a = queue.enqueue(rename('work', 'Rejected'));
    const b = queue.enqueue(rename('social', 'Friends'));
    await expect(a).rejects.toThrow('conflict');
    await b;
    expect(requests[1].revision).toBe(9);
    expect(requests[1].categories[0].name).toBe('Work');
    expect(requests[1].categories[1].name).toBe('Friends');
  });

  it('rolls back rejected optimistic state when conflict refetch fails', async () => {
    const changes: ChannelCategoryLayout[] = [];
    const queue = new ChannelCategoryMutationQueue(
      layout,
      async () => {
        throw Object.assign(new Error('conflict'), { status: 409 });
      },
      async () => {
        throw new Error('refetch failed');
      },
      (next) => changes.push(next)
    );

    await expect(queue.enqueue(rename('work', 'Rejected'))).rejects.toThrow(
      'refetch failed'
    );
    expect(changes.at(-1)).toEqual(layout);
    expect(queue.optimistic()).toEqual(layout);
  });

  it('cannot refetch or publish after an auth-generation transition', async () => {
    let active = true;
    let rejectPersist!: (error: unknown) => void;
    const changes: ChannelCategoryLayout[] = [];
    const refetch = vi.fn(async () => ({ ...layout, revision: 10 }));
    const queue = new ChannelCategoryMutationQueue(
      layout,
      () =>
        new Promise((_, reject) => {
          rejectPersist = reject;
        }),
      refetch,
      (next) => changes.push(next),
      () => active
    );
    const pending = queue.enqueue(rename('work', 'Old user'));
    expect(changes.at(-1)?.categories[0].name).toBe('Old user');
    await Promise.resolve();

    active = false;
    queue.dispose();
    rejectPersist(Object.assign(new Error('conflict'), { status: 409 }));

    await expect(pending).rejects.toBeInstanceOf(StaleCategorySessionError);
    expect(refetch).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
  });

  it('replays three queued intents in order after the middle fails', async () => {
    let calls = 0;
    const queue = new ChannelCategoryMutationQueue(layout, async (next) => {
      calls += 1;
      if (calls === 2) throw new Error('middle failed');
      return { ...next, revision: next.revision + 1 };
    });
    const a = queue.enqueue(rename('work', 'Projects'));
    const b = queue.enqueue({ type: 'delete-category', categoryId: 'work' });
    const c = queue.enqueue(rename('social', 'Friends'));
    await a;
    await expect(b).rejects.toThrow('middle failed');
    await c;
    expect(queue.optimistic().categories).toEqual([
      { id: 'work', name: 'Projects' },
      { id: 'social', name: 'Friends' },
    ]);
    expect(queue.optimistic().revision).toBe(6);
  });
});
