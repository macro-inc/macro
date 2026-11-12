import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  InboxFeedSource,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import { createInboxList, type InboxDoneNotices } from './inbox-list';

const row = (id: string): NotificationInboxRow => ({
  id,
  type: 'task',
  revision: `rev-${id}`,
  latestAt: 1,
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: { type: 'document', id, name: 'Plan' } as never,
    notifications: [],
  },
});

function fakeFeed(overrides: Partial<InboxFeedSource> = {}) {
  const [rows, setRows] = createSignal<NotificationInboxRow[] | undefined>();
  const [error, setError] = createSignal<Error>();
  const [hasMore, setHasMore] = createSignal(false);
  const feed: InboxFeedSource = {
    rows,
    isLoading: () => rows() === undefined,
    error,
    hasMore,
    isLoadingMore: () => false,
    loadMore: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    markDone: vi.fn(async () => ({ undo: vi.fn(async () => {}) })),
    markNotificationDone: vi.fn(async () => ({ undo: vi.fn(async () => {}) })),
    clear: vi.fn(async () => ({
      count: 0,
      complete: true,
      undo: vi.fn(async () => {}),
    })),
    markSeen: vi.fn(async () => {}),
    ...overrides,
  };
  return { feed, setRows, setError, setHasMore };
}

function notices() {
  const dismiss = vi.fn();
  const undoEntries: { undo: () => Promise<void>; onUndone: () => void }[] = [];
  return {
    dismiss,
    undoEntries,
    value: {
      pushUndo: vi.fn((entry: (typeof undoEntries)[number]) => {
        undoEntries.push(entry);
        return {
          undo: async () => {
            await entry.undo();
            entry.onUndone();
          },
        };
      }),
      announceDone: vi.fn<InboxDoneNotices['announceDone']>(() => dismiss),
      announceCleared: vi.fn<InboxDoneNotices['announceCleared']>(
        () => dismiss
      ),
      announceFailure: vi.fn(),
    },
  };
}

describe('createInboxList', () => {
  it('moves from loading to rows, and keeps rows through a failed refresh', () => {
    createRoot((dispose) => {
      const { feed, setRows, setError } = fakeFeed();
      const list = createInboxList(feed, notices().value);
      expect(list.view().t).toBe('loading');

      setRows([row('a#task')]);
      expect(list.view()).toMatchObject({ t: 'ready', stale: false });

      setError(new Error('offline'));
      expect(list.view()).toMatchObject({ t: 'ready', stale: true });
      dispose();
    });
  });

  it('is empty only when nothing is left to load', () => {
    createRoot((dispose) => {
      const { feed, setRows, setHasMore } = fakeFeed();
      const list = createInboxList(feed, notices().value);
      setRows([]);
      setHasMore(true);
      // Every row of the loaded page waits for the next one: keep paging.
      expect(list.view()).toMatchObject({ t: 'ready', rows: [] });

      setHasMore(false);
      expect(list.view()).toEqual({ t: 'empty' });
      dispose();
    });
  });

  it('fails to an error state before any rows load', () => {
    createRoot((dispose) => {
      const { feed, setError } = fakeFeed();
      const list = createInboxList(feed, notices().value);
      setError(new Error('offline'));
      expect(list.view().t).toBe('error');
      dispose();
    });
  });

  it('announces a done with an undo that reverses it and dismisses the notice', async () => {
    const undo = vi.fn(async () => {});
    const { feed } = fakeFeed({ markDone: vi.fn(async () => ({ undo })) });
    const n = notices();
    const list = createInboxList(feed, n.value);

    await list.markDone([row('a#task')]);
    expect(n.value.announceDone).toHaveBeenCalledWith(1, expect.any(Function));

    const announcedUndo = vi.mocked(n.value.announceDone).mock.calls[0][1];
    await announcedUndo();
    expect(undo).toHaveBeenCalledOnce();
    expect(n.dismiss).toHaveBeenCalled();
  });

  it('announces a failed done instead of an undo', async () => {
    const { feed } = fakeFeed({
      markDone: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const n = notices();
    const list = createInboxList(feed, n.value);

    await list.markDone([row('a#task')]);

    expect(n.value.announceFailure).toHaveBeenCalled();
    expect(n.value.announceDone).not.toHaveBeenCalled();
    expect(n.value.pushUndo).not.toHaveBeenCalled();
  });

  it('announces a clear with its count and puts its undo on the stack', async () => {
    const undo = vi.fn(async () => {});
    const { feed } = fakeFeed({
      clear: vi.fn(async () => ({ count: 12, complete: true, undo })),
    });
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: false });

    expect(announced.value.announceCleared).toHaveBeenCalledWith(
      12,
      expect.any(Function),
      true
    );
    await announced.value.announceCleared.mock.calls[0][1]();
    expect(undo).toHaveBeenCalledOnce();
    expect(announced.dismiss).toHaveBeenCalled();
  });

  it('offers undo for a clear still running, even with nothing cleared yet', async () => {
    const undo = vi.fn(async () => {});
    const { feed } = fakeFeed({
      clear: vi.fn(async () => ({ count: 0, complete: false, undo })),
    });
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: false });

    expect(announced.value.announceCleared).toHaveBeenCalledWith(
      0,
      expect.any(Function),
      false
    );
    expect(announced.value.pushUndo).toHaveBeenCalled();
  });

  it('announces a clear again with its final count when the server finishes it', async () => {
    const undo = vi.fn(async () => {});
    let finish: (count: number | undefined) => void = () => {};
    const finished = new Promise<number | undefined>((resolve) => {
      finish = resolve;
    });
    const { feed } = fakeFeed({
      clear: vi.fn(async () => ({
        count: 40,
        complete: false,
        finished,
        undo,
      })),
    });
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: false });
    expect(announced.value.announceCleared).toHaveBeenCalledTimes(1);

    finish(4_300);
    await Promise.resolve();
    await Promise.resolve();

    expect(announced.dismiss).toHaveBeenCalledOnce();
    expect(announced.value.announceCleared).toHaveBeenLastCalledWith(
      4_300,
      expect.any(Function),
      true
    );
  });

  it('announces nothing more for a clear that was undone before it finished', async () => {
    const { feed } = fakeFeed({
      clear: vi.fn(async () => ({
        count: 40,
        complete: false,
        finished: Promise.resolve(undefined),
        undo: vi.fn(async () => {}),
      })),
    });
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(announced.value.announceCleared).toHaveBeenCalledTimes(1);
  });

  it('says when a clear took nothing, with nothing to undo', async () => {
    const { feed } = fakeFeed();
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: true });

    expect(announced.value.announceCleared).toHaveBeenCalledWith(
      0,
      expect.any(Function)
    );
    expect(announced.value.pushUndo).not.toHaveBeenCalled();
  });

  it('announces a failed clear', async () => {
    const { feed } = fakeFeed({
      clear: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const announced = notices();
    const inbox = createInboxList(feed, announced.value);

    await inbox.clear({ rowTypes: ['email'], unreadOnly: false });

    expect(announced.value.announceFailure).toHaveBeenCalledOnce();
    expect(announced.value.announceCleared).not.toHaveBeenCalled();
  });
});
