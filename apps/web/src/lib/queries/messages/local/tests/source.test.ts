import type { CacheHost } from '@graphql-cache/index';
import type {
  MessageThread,
  MessageTimelinePage,
} from '@service-storage/messages';
import { onlineManager } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdUnheldReads,
  loadLocalChannelThread,
  loadLocalChannelTimelinePage,
} from '../source';
import { noteUnheldRead, resetUnheldReads, unheldReads } from '../unheld-reads';
import { CHANNEL_ID } from './fixtures';

const mocks = vi.hoisted(() => ({
  channelCacheHost: vi.fn(),
  loadChannelPage: vi.fn(),
  loadChannelThread: vi.fn(),
  pushesStored: vi.fn(),
  catchUpAndRefresh: vi.fn(async () => {}),
  channelCacheAnswered: vi.fn(() => true),
  withUnsettledThreadReplies: vi.fn(),
  listQueuedReplies: vi.fn(),
}));

vi.mock('../flag', () => ({
  channelCacheHost: mocks.channelCacheHost,
  channelCacheAnswered: mocks.channelCacheAnswered,
}));
vi.mock('../pages', () => ({
  loadChannelPage: mocks.loadChannelPage,
  pageHasPendingWrites: vi.fn(async () => false),
}));
vi.mock('../thread', () => ({
  loadChannelThread: mocks.loadChannelThread,
  loadChannelMessage: vi.fn(),
}));
vi.mock('../unsettled-replies', () => ({
  listQueuedReplies: mocks.listQueuedReplies,
  pageHasQueuedReplies: vi.fn(async () => false),
  withUnsettledThreadReplies: mocks.withUnsettledThreadReplies,
}));
vi.mock('../catch-up', () => ({
  MAX_PUSH_REREADS: 3,
  catchUpAndRefresh: mocks.catchUpAndRefresh,
  catchUpChannel: vi.fn(),
  pushesStored: mocks.pushesStored,
  refreshChannelViews: vi.fn(),
}));

const host = {
  channelTimelineCommit: vi.fn(async () => ({})),
} as unknown as CacheHost;
const page = (name: string) => ({ name }) as unknown as MessageTimelinePage;
const devicePage = (name: string, storedSeq: string) => ({
  page: page(name),
  source: 'device' as const,
  storedSeq,
});
const thread = (name: string) => ({ name }) as unknown as MessageThread;
const read = { channelId: CHANNEL_ID, limit: 50 };
const QUEUED = Promise.resolve(new Map<string, string>());

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.channelCacheHost.mockReturnValue(host);
  mocks.catchUpAndRefresh.mockResolvedValue(undefined);
  mocks.listQueuedReplies.mockReturnValue(QUEUED);
  mocks.withUnsettledThreadReplies.mockImplementation(
    async (_host, _channelId, read) => read
  );
  mocks.channelCacheAnswered.mockReturnValue(true);
  localStorage.clear();
  resetUnheldReads();
});

afterEach(() => onlineManager.setOnline(true));

describe('loadLocalChannelTimelinePage', () => {
  it('answers with the device page when no push is ahead of it', async () => {
    mocks.loadChannelPage.mockResolvedValue(devicePage('first', '7'));
    mocks.pushesStored.mockResolvedValue(false);

    expect(await loadLocalChannelTimelinePage(read)).toEqual(page('first'));
    expect(mocks.loadChannelPage).toHaveBeenCalledTimes(1);
    expect(mocks.pushesStored).toHaveBeenCalledWith(CHANNEL_ID, '7');
  });

  it('reads the device again once it holds a push the views already show', async () => {
    mocks.loadChannelPage
      .mockResolvedValueOnce(devicePage('older', '7'))
      .mockResolvedValueOnce(devicePage('current', '8'));
    mocks.pushesStored.mockResolvedValueOnce(true).mockResolvedValue(false);

    expect(await loadLocalChannelTimelinePage(read)).toEqual(page('current'));
    expect(mocks.pushesStored.mock.calls).toEqual([
      [CHANNEL_ID, '7'],
      [CHANNEL_ID, '8'],
    ]);
  });

  it('stops reading again while pushes keep arriving', async () => {
    mocks.loadChannelPage.mockResolvedValue(devicePage('page', '7'));
    mocks.pushesStored.mockResolvedValue(true);

    expect(await loadLocalChannelTimelinePage(read)).toEqual(page('page'));
    expect(mocks.loadChannelPage).toHaveBeenCalledTimes(4);
  });

  it('does not wait on a page the server answered', async () => {
    mocks.loadChannelPage.mockResolvedValue({
      page: page('server'),
      source: 'server',
      serverSeq: '9',
      stored: Promise.resolve('9'),
    });

    expect(await loadLocalChannelTimelinePage(read)).toEqual(page('server'));
    expect(mocks.pushesStored).not.toHaveBeenCalled();
  });

  it('stops when the read is cancelled during the wait', async () => {
    const controller = new AbortController();
    mocks.loadChannelPage.mockResolvedValue(devicePage('older', '7'));
    mocks.pushesStored.mockImplementation(async () => {
      controller.abort();
      return true;
    });

    await expect(
      loadLocalChannelTimelinePage({ ...read, signal: controller.signal })
    ).rejects.toThrow();
    expect(mocks.loadChannelPage).toHaveBeenCalledTimes(1);
  });

  it('leaves the read to REST when the device stops serving it', async () => {
    mocks.loadChannelPage
      .mockResolvedValueOnce(devicePage('older', '7'))
      .mockResolvedValueOnce('not-ready');
    mocks.pushesStored.mockResolvedValue(true);

    expect(await loadLocalChannelTimelinePage(read)).toBeUndefined();
  });
});

describe('loadLocalChannelThread', () => {
  it('reads the device thread again once it holds a pushed change', async () => {
    mocks.loadChannelThread
      .mockResolvedValueOnce({ thread: thread('older'), source: 'device' })
      .mockResolvedValueOnce({ thread: thread('current'), source: 'device' });
    mocks.pushesStored.mockResolvedValueOnce(true).mockResolvedValue(false);

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toEqual(
      thread('current')
    );
    expect(mocks.loadChannelThread).toHaveBeenCalledTimes(2);
  });

  it('does not wait on a thread the server answered', async () => {
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toEqual(
      thread('server')
    );
    expect(mocks.pushesStored).not.toHaveBeenCalled();
  });

  it('answers a thread with the replies still waiting put into it', async () => {
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });
    mocks.withUnsettledThreadReplies.mockResolvedValue(thread('with waiting'));

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toEqual(
      thread('with waiting')
    );
    expect(mocks.withUnsettledThreadReplies).toHaveBeenCalledExactlyOnceWith(
      host,
      CHANNEL_ID,
      thread('server'),
      QUEUED
    );
  });

  it('answers the thread as read when the waiting replies cannot be put in', async () => {
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });
    mocks.withUnsettledThreadReplies.mockRejectedValue(new Error('retired'));

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toEqual(
      thread('server')
    );
  });

  it('leaves a thread to REST while the host starts, and has the device hold it too', async () => {
    mocks.channelCacheAnswered.mockReturnValue(false);
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toBeUndefined();
    expect(mocks.loadChannelThread).toHaveBeenCalledExactlyOnceWith(
      host,
      CHANNEL_ID,
      'root'
    );
  });

  it('notes a thread REST answered until the device is given it', async () => {
    mocks.channelCacheAnswered.mockReturnValue(false);
    // The host is still starting: the hold has not settled.
    mocks.loadChannelThread.mockReturnValue(new Promise(() => {}));

    await loadLocalChannelThread(CHANNEL_ID, 'root');

    expect(unheldReads()).toEqual([{ channelId: CHANNEL_ID, rootId: 'root' }]);
  });
});

describe('holdUnheldReads', () => {
  const leftPage = { channelId: 'left-channel' };
  const leftThread = { channelId: CHANNEL_ID, rootId: 'left-root' };
  // Noted by a page that is gone: in storage, not in this page's memory.
  const leave = (...reads: Array<{ channelId: string; rootId?: string }>) => {
    for (const read of reads) noteUnheldRead(read);
    resetUnheldReads();
  };

  it('has the device hold the pages and threads a page that is gone left noted', async () => {
    leave(leftPage, leftThread);
    let stored = false;
    mocks.loadChannelPage.mockResolvedValue({
      page: page('server'),
      source: 'server',
      serverSeq: '9',
      stored: (async () => {
        await Promise.resolve();
        stored = true;
        return '9';
      })(),
    });
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });

    await holdUnheldReads(host);

    expect(mocks.loadChannelPage).toHaveBeenCalledExactlyOnceWith(host, {
      channelId: 'left-channel',
      limit: 50,
    });
    expect(stored).toBe(true);
    expect(mocks.loadChannelThread).toHaveBeenCalledExactlyOnceWith(
      host,
      CHANNEL_ID,
      'left-root'
    );
    expect(unheldReads()).toEqual([]);
  });

  it('leaves the reads this page is still storing, and runs one pass at a time', async () => {
    leave(leftThread);
    noteUnheldRead(leftPage);
    let finish = () => {};
    mocks.loadChannelThread.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ thread: thread('s'), source: 'server' });
      })
    );

    const first = holdUnheldReads(host);
    const second = holdUnheldReads(host);
    finish();
    await Promise.all([first, second]);

    expect(mocks.loadChannelThread).toHaveBeenCalledTimes(1);
    expect(mocks.loadChannelPage).not.toHaveBeenCalled();
    expect(unheldReads()).toEqual([leftPage]);
  });

  it('keeps them noted without a connection', async () => {
    leave(leftPage, leftThread);
    onlineManager.setOnline(false);

    await holdUnheldReads(host);

    expect(mocks.loadChannelPage).not.toHaveBeenCalled();
    expect(unheldReads()).toEqual([leftPage, leftThread]);
  });

  it('keeps a read noted when the connection drops during it', async () => {
    leave(leftThread);
    mocks.loadChannelThread.mockImplementation(async () => {
      onlineManager.setOnline(false);
      throw new Error('Failed to fetch');
    });

    await holdUnheldReads(host);

    expect(unheldReads()).toEqual([leftThread]);
  });

  it('gives up a read the server refuses and carries on', async () => {
    leave(leftPage, leftThread);
    mocks.loadChannelPage.mockRejectedValue(new Error('FORBIDDEN'));
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('device'),
      source: 'device',
    });

    await holdUnheldReads(host);

    expect(mocks.loadChannelThread).toHaveBeenCalledTimes(1);
    expect(unheldReads()).toEqual([]);
  });
});
