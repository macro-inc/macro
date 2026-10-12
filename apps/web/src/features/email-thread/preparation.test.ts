import { prepareEmailBody } from '@macro-inc/email-renderer';
import { expect, it, vi } from 'vitest';
import type { EmailPreparation } from '../email-message/context/email-preparation';
import { message } from '../email-message/tests/messages';
import type { EmailThread } from './core/email-thread';
import { prepareThreads, type ThreadPreparationSource } from './preparation';

const body = prepareEmailBody({ html: '<p>Prepared</p>' });
function thread(messages = [message('last')]): EmailThread {
  return {
    db_id: 'thread',
    access_level: 'owner',
    inbox_visible: true,
    is_read: false,
    link_id: 'inbox',
    messages,
  };
}

it.each([false, true])(
  'selects visible bodies and preserves partial-page quote policy (%s)',
  async (hasMore) => {
    const acquire = vi.fn<EmailPreparation['acquire']>(() => ({
      ready: body,
      promise: Promise.resolve(body),
      promote() {},
      release: vi.fn(),
    }));
    const releaseSource = vi.fn();
    const read = vi.fn<ThreadPreparationSource['read']>(
      async (_id, _localOnly, retain) => {
        retain(releaseSource);
        return {
          hasMore,
          thread: thread([
            message('first', { labels: [{ provider_label_id: 'UNREAD' }] }),
            message('hidden', { labels: [{ provider_label_id: 'UNREAD' }] }),
            message('read'),
            message('last'),
          ]),
        };
      }
    );
    const images = { remote: 'block' as const };
    const release = prepareThreads(
      { acquire },
      { read },
      images,
      ['thread'],
      4,
      true
    );
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenCalledWith('thread', true, expect.any(Function));
    expect(acquire.mock.calls.map(([request]) => request.messageId)).toEqual([
      'first',
      'last',
    ]);
    expect(acquire.mock.calls[0][0]).toMatchObject({
      mailboxId: 'inbox',
      options: { images, showFullContent: !hasMore },
      priority: 4,
    });
    expect(acquire.mock.calls[1][0].options.showFullContent).toBe(false);
    expect(releaseSource).not.toHaveBeenCalled();
    release();
    release();
    expect(releaseSource).toHaveBeenCalledOnce();
    for (const result of acquire.mock.results) {
      if (result.type === 'return')
        expect(result.value.release).toHaveBeenCalledOnce();
    }
  }
);

it('releases late source retention without preparing a cancelled page', async () => {
  const pending = Promise.withResolvers<{
    thread: EmailThread;
    hasMore: boolean;
  }>();
  let retain: ((release: () => void) => void) | undefined;
  const acquire = vi.fn<EmailPreparation['acquire']>();
  const releaseSource = vi.fn();
  const release = prepareThreads(
    { acquire },
    {
      read: async (_id, _localOnly, onRetain) => {
        retain = onRetain;
        return await pending.promise;
      },
    },
    { remote: 'block' },
    ['thread'],
    2
  );
  release();
  retain?.(releaseSource);
  pending.resolve({ thread: thread(), hasMore: false });
  await pending.promise;
  expect(releaseSource).toHaveBeenCalledOnce();
  expect(acquire).not.toHaveBeenCalled();
});

it('releases in-flight leases once and skips later messages after cancellation', async () => {
  const pending = Promise.withResolvers<typeof body>();
  const releaseBody = vi.fn();
  const acquire = vi.fn<EmailPreparation['acquire']>(() => ({
    ready: undefined,
    promise: pending.promise,
    promote() {},
    release: releaseBody,
  }));
  const release = prepareThreads(
    { acquire },
    {
      read: async () => ({ thread: thread(), hasMore: false }),
    },
    { remote: 'block' },
    ['a', 'b'],
    2
  );
  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
  release();
  pending.resolve(body);
  await pending.promise;
  expect(releaseBody).toHaveBeenCalledOnce();
  expect(acquire).toHaveBeenCalledOnce();
});

it('contains source failures and releases source retention', async () => {
  const releaseSource = vi.fn();
  prepareThreads(
    { acquire: vi.fn() },
    {
      read: async (_id, _localOnly, retain) => {
        retain(releaseSource);
        throw new Error('Source unavailable');
      },
    },
    { remote: 'block' },
    ['thread'],
    2
  );
  await vi.waitFor(() => expect(releaseSource).toHaveBeenCalledOnce());
});
