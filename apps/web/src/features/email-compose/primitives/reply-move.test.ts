import { beforeEach, expect, it, vi } from 'vitest';
import type { ReplyType } from '../core/reply-type';
import { createReplyMove, type ReplyMoveTarget } from './reply-move';

const spans = vi.hoisted(
  () =>
    [] as { name: string; attrs: Record<string, unknown>; error?: unknown }[]
);
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: async (name: string, operation: (span: unknown) => Promise<void>) => {
      const record: (typeof spans)[number] = { name, attrs: {} };
      spans.push(record);
      return await operation({
        setAttr: (key: string, value: unknown) => {
          record.attrs[key] = value;
        },
        error: (error: unknown) => {
          record.error = error;
        },
      });
    },
  },
}));

beforeEach(() => {
  spans.length = 0;
});

function setup(options: { saveDraft?: () => Promise<unknown> } = {}) {
  const move = vi.fn<(replyType: ReplyType) => void>();
  const reportError = vi.fn();
  const saveDraft = vi.fn(options.saveDraft ?? (async () => undefined));
  const target: ReplyMoveTarget = { inWindow: false, move };
  const moveReply = createReplyMove({
    target: () => target,
    isSending: () => false,
    hasContent: () => true,
    saveDraft,
    reportError,
    replyType: () => 'reply-all',
    threadId: () => 'thread-1',
    draftId: () => 'draft-1',
  });
  return { moveReply, move, reportError, saveDraft };
}

it('saves the draft, then moves the reply with its type', async () => {
  const { moveReply, move, saveDraft } = setup();

  await moveReply();

  expect(saveDraft).toHaveBeenCalledOnce();
  expect(move).toHaveBeenCalledWith('reply-all');
  expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
    move.mock.invocationCallOrder[0]
  );
  expect(spans).toEqual([
    {
      name: 'email.reply.move',
      attrs: {
        'email.thread_id': 'thread-1',
        'email.reply.to_window': true,
        'email.draft_id': 'draft-1',
      },
    },
  ]);
});

it('moves once when asked again while the draft is still saving', async () => {
  let finishSave!: () => void;
  const { moveReply, move, saveDraft } = setup({
    saveDraft: () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  });

  const first = moveReply();
  await moveReply();
  finishSave();
  await first;

  expect(saveDraft).toHaveBeenCalledOnce();
  expect(move).toHaveBeenCalledOnce();

  // Once it has moved, the next request moves it again.
  const third = moveReply();
  finishSave();
  await third;
  expect(move).toHaveBeenCalledTimes(2);
});

it('keeps a reply that fails to save where it is, with the failure shown', async () => {
  const failure = new Error('offline');
  const { moveReply, move, reportError } = setup({
    saveDraft: async () => {
      throw failure;
    },
  });

  await moveReply();

  expect(move).not.toHaveBeenCalled();
  expect(reportError).toHaveBeenCalledWith(failure);
  expect(spans[0]?.error).toBe(failure);

  // A failed attempt does not block the next one.
  await moveReply();
  expect(reportError).toHaveBeenCalledTimes(2);
});

it('does nothing while sending or without a place to move to', async () => {
  const move = vi.fn();
  const saveDraft = vi.fn(async () => undefined);
  const base = {
    hasContent: () => true,
    saveDraft,
    reportError: vi.fn(),
    replyType: () => 'reply' as const,
    threadId: () => 'thread-1',
    draftId: () => undefined,
  };

  await createReplyMove({
    ...base,
    target: () => ({ inWindow: true, move }),
    isSending: () => true,
  })();
  await createReplyMove({
    ...base,
    target: () => undefined,
    isSending: () => false,
  })();

  expect(saveDraft).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
});
