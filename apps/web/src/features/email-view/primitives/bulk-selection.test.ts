import type {
  ApiBulkThreadAction,
  ApiBulkThreadTarget,
} from '@service-email/generated/schemas';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailBulkQuery } from '../queries/bulk-query';
import type { EmailBulkTargetsRequest } from '../queries/bulk-threads';
import { createEmailBulkOverlay } from './bulk-overlay';
import {
  createEmailBulkSelection,
  type EmailBulkCapabilities,
} from './bulk-selection';

const SIGNAL: EmailBulkQuery = {
  ef: { l: { Importance: true } },
  emailView: 'inbox',
};

function thread(
  id: string,
  state: { done?: boolean; read?: boolean } = {}
): ApiBulkThreadTarget {
  return {
    id,
    done: state.done ?? false,
    read: state.read ?? false,
    sortTs: '2025-03-01T09:00:00Z',
  };
}

type Announcement = Parameters<EmailBulkCapabilities['announce']>[0];

/** A fake mail server holding one view's threads, newest first. */
function setup(threads: ApiBulkThreadTarget[], pageSize = 2) {
  const archived = new Set<string>(
    threads.filter((t) => t.done).map((t) => t.id)
  );
  const read = new Set<string>(threads.filter((t) => t.read).map((t) => t.id));
  const failing = new Set<string>();
  const applied: { threadIds: string[]; action: ApiBulkThreadAction }[] = [];
  const announcements: Announcement[] = [];
  const failures: string[] = [];
  const prompts: { title: string; body: string; confirmLabel: string }[] = [];
  let confirmAnswer = true;

  const listTargets = vi.fn(async (request: EmailBulkTargetsRequest) => {
    const start = request.cursor
      ? threads.findIndex((t) => t.id === request.cursor?.threadId) + 1
      : request.fromThreadId
        ? threads.findIndex((t) => t.id === request.fromThreadId)
        : 0;
    if (start < 0)
      return err([{ code: 'NOT_FOUND', message: 'Resource not found' }]);
    const page = threads.slice(start, start + pageSize).map((t) => ({
      ...t,
      done: archived.has(t.id),
      read: read.has(t.id),
    }));
    const last = page.at(-1);
    const more = start + pageSize < threads.length;
    return ok({
      threads: page,
      nextCursor:
        more && last ? { threadId: last.id, sortTs: last.sortTs } : null,
    });
  });

  const capabilities: EmailBulkCapabilities = {
    listTargets,
    applyAction: vi.fn(
      async (threadIds: string[], action: ApiBulkThreadAction) => {
        applied.push({ threadIds, action });
        const succeededIds = threadIds.filter((id) => !failing.has(id));
        for (const id of succeededIds) {
          if (action === 'archive') archived.add(id);
          if (action === 'unarchive') archived.delete(id);
          if (action === 'mark_read') read.add(id);
          if (action === 'mark_unread') read.delete(id);
        }
        return ok({
          succeededIds,
          failedIds: threadIds.filter((id) => failing.has(id)),
        });
      }
    ),
    markNotificationsDone: vi.fn(async (threadIds: string[]) =>
      ok(threadIds.map((id) => `notification-${id}`))
    ),
    restoreNotifications: vi.fn(async () => ok(undefined)),
    refreshLists: vi.fn(async () => {}),
    confirm: vi.fn(async (prompt) => {
      prompts.push(prompt);
      return confirmAnswer;
    }),
    announce: (announcement) => announcements.push(announcement),
    failure: (message) => failures.push(message),
  };

  return createRoot((dispose) => {
    const [query, setQuery] = createSignal<EmailBulkQuery | undefined>(SIGNAL);
    const overlay = createEmailBulkOverlay();
    const bulk = createEmailBulkSelection({
      capabilities,
      overlay,
      query,
      viewLabel: () => 'Signal',
    });
    return {
      dispose,
      bulk,
      overlay,
      capabilities,
      listTargets,
      setQuery,
      archived,
      read,
      failing,
      applied,
      announcements,
      failures,
      prompts,
      decline: () => {
        confirmAnswer = false;
      },
    };
  });
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function mount(threads: ApiBulkThreadTarget[], pageSize?: number) {
  const view = setup(threads, pageSize);
  cleanup = view.dispose;
  return view;
}

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `thread-${index + 1}`);

describe('Select all below', () => {
  it('selects the row and every older thread, including ones the list never loaded', async () => {
    const view = mount(ids(5).map((id) => thread(id)));

    await view.bulk.selectBelow('thread-2');

    const state = view.bulk.state();
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' && state.targets.map((t) => t.id)).toEqual([
      'thread-2',
      'thread-3',
      'thread-4',
      'thread-5',
    ]);
    // Two pages of two: the anchor starts the first, the cursor the second.
    expect(view.listTargets.mock.calls.map(([request]) => request)).toEqual([
      { query: SIGNAL, fromThreadId: 'thread-2', cursor: undefined },
      {
        query: SIGNAL,
        fromThreadId: undefined,
        cursor: { threadId: 'thread-3', sortTs: '2025-03-01T09:00:00Z' },
      },
    ]);
  });

  it('reports how many threads it has found while it is still selecting', async () => {
    const view = mount(ids(5).map((id) => thread(id)));
    const serve = view.listTargets.getMockImplementation()!;
    let requestSecondPage!: () => void;
    const secondPageRequested = new Promise<void>((resolve) => {
      requestSecondPage = resolve;
    });
    let releaseSecondPage!: () => void;
    const secondPageReleased = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    view.listTargets
      .mockImplementationOnce(serve)
      .mockImplementationOnce(async (request) => {
        requestSecondPage();
        await secondPageReleased;
        return serve(request);
      });

    const selecting = view.bulk.selectView();
    await secondPageRequested;

    expect(view.bulk.state()).toMatchObject({ status: 'resolving', count: 2 });
    releaseSecondPage();
    await selecting;
    expect(view.bulk.state()).toMatchObject({ status: 'ready' });
  });

  it('explains when the row has left the view and can try again', async () => {
    const view = mount([thread('thread-1')]);

    await view.bulk.selectBelow('archived-elsewhere');

    expect(view.bulk.state()).toMatchObject({
      status: 'failed',
      message: 'That email is no longer in Signal.',
    });
    await view.bulk.retry();
    expect(view.listTargets).toHaveBeenCalledTimes(2);
  });

  it('drops the selection when the view changes, ignoring pages still in flight', async () => {
    const view = mount(ids(3).map((id) => thread(id)));

    const selecting = view.bulk.selectView();
    view.setQuery({ ef: { l: { Importance: false } }, emailView: 'inbox' });
    await selecting;

    expect(view.bulk.state()).toEqual({ status: 'idle' });
    expect(view.bulk.isActive()).toBe(false);
  });

  it('is unavailable where the server query cannot reach every row', () => {
    const view = mount([thread('thread-1')]);

    view.setQuery(undefined);

    expect(view.bulk.canSelect()).toBe(false);
  });
});

describe('Bulk Done', () => {
  it('confirms with the count it will change and archives it in batches of 100', async () => {
    const view = mount(
      [
        thread('already-done', { done: true }),
        ...ids(250).map((id) => thread(id)),
      ],
      500
    );
    await view.bulk.selectView();

    await view.bulk.run('done');

    expect(view.prompts).toEqual([
      {
        title: 'Mark 250 conversations done?',
        body: 'This marks every conversation in Signal as done. You can undo it afterwards.',
        confirmLabel: 'Mark done',
      },
    ]);
    expect(
      view.applied.map(({ threadIds, action }) => [threadIds.length, action])
    ).toEqual([
      [100, 'archive'],
      [100, 'archive'],
      [50, 'archive'],
    ]);
    expect(view.applied.flatMap(({ threadIds }) => threadIds)).not.toContain(
      'already-done'
    );
    expect(view.archived.size).toBe(251);
    expect(view.bulk.state()).toEqual({ status: 'idle' });
    expect(view.bulk.progress()).toBeUndefined();
    expect(view.announcements.map((a) => a.message)).toEqual([
      'Marked 250 conversations done',
    ]);
  });

  it('hides the threads at once and keeps them hidden while the server works', async () => {
    const view = mount(
      ids(3).map((id) => thread(id)),
      10
    );
    await view.bulk.selectBelow('thread-2');
    let startBatch!: () => void;
    const batchStarted = new Promise<void>((resolve) => {
      startBatch = resolve;
    });
    let resolveBatch!: () => void;
    const batchFinished = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    vi.mocked(view.capabilities.applyAction).mockImplementationOnce(
      async (threadIds) => {
        startBatch();
        await batchFinished;
        return ok({ succeededIds: threadIds, failedIds: [] });
      }
    );

    const running = view.bulk.run('done');
    await batchStarted;

    expect([...view.overlay.intents().keys()]).toEqual([
      'thread-2',
      'thread-3',
    ]);
    expect(view.bulk.progress()).toEqual({
      label: 'Marking done',
      completed: 0,
      total: 2,
    });
    resolveBatch();
    await running;
    expect([...view.overlay.intents().keys()]).toEqual([
      'thread-2',
      'thread-3',
    ]);
  });

  it('acknowledges the threads’ notifications and refreshes every mail list', async () => {
    const view = mount(
      ids(2).map((id) => thread(id)),
      10
    );
    await view.bulk.selectView();

    await view.bulk.run('done');

    expect(view.capabilities.markNotificationsDone).toHaveBeenCalledWith([
      'thread-1',
      'thread-2',
    ]);
    expect(view.capabilities.refreshLists).toHaveBeenCalledWith([
      'thread-1',
      'thread-2',
    ]);
  });

  it('changes nothing when the confirmation is declined', async () => {
    const view = mount(
      ids(2).map((id) => thread(id)),
      10
    );
    await view.bulk.selectView();
    view.decline();

    await view.bulk.run('done');

    expect(view.applied).toEqual([]);
    expect(view.overlay.intents().size).toBe(0);
    expect(view.bulk.state().status).toBe('ready');
  });

  it('says so instead of asking when everything selected is already done', async () => {
    const view = mount([thread('thread-1', { done: true })]);
    await view.bulk.selectView();

    await view.bulk.run('done');

    expect(view.prompts).toEqual([]);
    expect(view.failures).toEqual(['Those conversations are already done.']);
  });

  it('shows threads it could not change again and reports a partial result', async () => {
    const view = mount(
      ids(3).map((id) => thread(id)),
      10
    );
    view.failing.add('thread-2');
    await view.bulk.selectView();

    await view.bulk.run('done');

    expect([...view.overlay.intents().keys()]).toEqual([
      'thread-1',
      'thread-3',
    ]);
    expect(view.announcements[0]).toMatchObject({
      message: 'Marked 2 of 3 conversations done. Some couldn’t be changed.',
      partial: true,
    });
  });

  it('undo restores exactly the threads it archived, and their notifications', async () => {
    const view = mount(
      [thread('kept-done', { done: true }), ...ids(2).map((id) => thread(id))],
      10
    );
    await view.bulk.selectView();
    await view.bulk.run('done');

    await view.announcements[0].undo();

    expect(view.applied.at(-1)).toEqual({
      threadIds: ['thread-1', 'thread-2'],
      action: 'unarchive',
    });
    expect([...view.archived]).toEqual(['kept-done']);
    expect(view.capabilities.restoreNotifications).toHaveBeenCalledWith([
      'notification-thread-1',
      'notification-thread-2',
    ]);
    expect(view.overlay.intents().get('thread-1')?.done).toBe(false);

    await view.announcements[0].redo();
    expect(view.applied.at(-1)).toEqual({
      threadIds: ['thread-1', 'thread-2'],
      action: 'archive',
    });
    expect(view.archived.size).toBe(3);
  });

  it('refuses to undo or start another action while one is still applying', async () => {
    const view = mount(
      ids(4).map((id) => thread(id)),
      10
    );
    await view.bulk.selectBelow('thread-3');
    await view.bulk.run('done');
    await view.bulk.selectBelow('thread-1');
    let startBatch!: () => void;
    const batchStarted = new Promise<void>((resolve) => {
      startBatch = resolve;
    });
    let finishBatch!: () => void;
    const batchFinished = new Promise<void>((resolve) => {
      finishBatch = resolve;
    });
    vi.mocked(view.capabilities.applyAction).mockImplementationOnce(
      async (threadIds) => {
        startBatch();
        await batchFinished;
        return ok({ succeededIds: threadIds, failedIds: [] });
      }
    );
    const running = view.bulk.run('done');
    await batchStarted;

    await expect(view.announcements[0].undo()).rejects.toThrow(
      'Wait for the current bulk action to finish.'
    );
    await view.bulk.selectView();
    await view.bulk.run('read');
    expect(view.failures).toEqual([
      'Wait for the current bulk action to finish.',
    ]);

    finishBatch();
    await running;
    const actions = vi
      .mocked(view.capabilities.applyAction)
      .mock.calls.map(([, action]) => action);
    expect(actions).toEqual(['archive', 'archive']);
  });

  it('treats a failed request as failed threads, which a repeat can still change', async () => {
    const view = mount(
      ids(2).map((id) => thread(id)),
      10
    );
    await view.bulk.selectView();
    vi.mocked(view.capabilities.applyAction).mockResolvedValueOnce(
      err([{ code: 'NETWORK_ERROR', message: 'Network error occurred' }])
    );

    await view.bulk.run('done');

    expect(view.failures).toEqual(['Couldn’t mark 2 conversations done.']);
    expect(view.overlay.intents().size).toBe(0);
    expect(view.announcements).toEqual([]);
  });
});

describe('Bulk Mark read', () => {
  it('marks only unread threads read, and undo marks those unread again', async () => {
    const view = mount(
      [
        thread('thread-1', { read: true }),
        thread('thread-2'),
        thread('thread-3'),
      ],
      10
    );
    await view.bulk.selectBelow('thread-1');

    await view.bulk.run('read');

    expect(view.prompts[0]).toMatchObject({
      title: 'Mark 2 conversations read?',
      body: 'This marks the selected email and every older one in Signal as read. You can undo it afterwards.',
    });
    expect(view.applied).toEqual([
      { threadIds: ['thread-2', 'thread-3'], action: 'mark_read' },
    ]);
    expect(view.capabilities.markNotificationsDone).not.toHaveBeenCalled();

    await view.announcements[0].undo();
    expect(view.applied.at(-1)).toEqual({
      threadIds: ['thread-2', 'thread-3'],
      action: 'mark_unread',
    });
    expect([...view.read]).toEqual(['thread-1']);
  });
});
