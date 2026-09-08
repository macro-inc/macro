import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { message, thread } from '../tests/fixtures';
import { createEmailThreadSource, decodeThread } from './thread-source';

describe('thread query adaptation', () => {
  it('guards resource reads, retains available data during refresh errors, and clears it when switching threads', () =>
    createRoot((dispose) => {
      try {
        const [id, setId] = createSignal('thread');
        const [status, setStatus] = createSignal('pending');
        const [data, setData] = createSignal<ThreadQueryData | undefined>();
        const fetchNextPage = vi.fn();
        const refetch = vi.fn();
        const read = vi.fn(() => {
          if (status() === 'pending')
            throw new Error('suspending resource read');
          return data();
        });
        const query = {
          get isError() {
            return status() === 'error';
          },
          get isSuccess() {
            return status() === 'success';
          },
          get isLoading() {
            return status() === 'pending';
          },
          isFetching: false,
          isFetchingNextPage: false,
          hasNextPage: true,
          get data() {
            return read();
          },
          fetchNextPage,
          refetch,
        } as unknown as ThreadQueryResult<ThreadQueryData>;
        const source = createEmailThreadSource(id, query);
        expect(source.thread()).toBeUndefined();
        expect(read).not.toHaveBeenCalled();
        const original = thread([message('first')]);
        batch(() => {
          setData({ thread: original } as ThreadQueryData);
          setStatus('success');
        });
        expect(source.thread()?.messages[0].db_id).toBe('first');
        expect(source.thread()).not.toBe(original);
        setStatus('error');
        expect(source.thread()?.db_id).toBe('thread');
        source.fetchOlder();
        source.refresh();
        expect(fetchNextPage).toHaveBeenCalledOnce();
        expect(refetch).toHaveBeenCalledOnce();
        setId('other');
        expect(source.thread()).toBeUndefined();
        batch(() => {
          setData(undefined);
          setStatus('success');
        });
        expect(source.thread()).toBeUndefined();
      } finally {
        dispose();
      }
    }));
  it('owns nested message data while preserving missing versus empty HTML', () => {
    const wire = thread([
      message('one', { body_replyless: '' }),
      message('two', { body_replyless: null }),
    ]);
    const decoded = decodeThread(wire);
    expect(decoded.messages.map((m) => m.body_replyless)).toEqual(['', null]);
    decoded.messages[0].to[0].email = 'changed@example.com';
    expect(wire.messages[0].to[0].email).toBe('viewer@example.com');
  });
});

it('exposes cached data when the first observed query result is an error', () =>
  createRoot((dispose) => {
    try {
      const cached = thread([message('cached')]);
      const query = {
        isError: true,
        isSuccess: false,
        isLoading: false,
        data: { thread: cached, hasMore: false },
      } as ThreadQueryResult<ThreadQueryData>;
      expect(
        createEmailThreadSource(() => 'thread', query).thread()?.messages[0]
          .db_id
      ).toBe('cached');
    } finally {
      dispose();
    }
  }));

it.each(['fetchOlder', 'refresh'] as const)(
  '%s remains pending until the query request finishes',
  async (operation) => {
    let finish!: () => void;
    const request = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { source, dispose } = createRoot((dispose) => ({
      dispose,
      source: createEmailThreadSource(() => 'thread', {
        isSuccess: false,
        isError: false,
        fetchNextPage: () => request,
        refetch: () => request,
      } as unknown as ThreadQueryResult<ThreadQueryData>),
    }));
    try {
      let completed = false;
      const completion = source[operation]().then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      finish();
      await completion;
      expect(completed).toBe(true);
    } finally {
      dispose();
    }
  }
);
