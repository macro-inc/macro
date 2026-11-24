import { endComposerSession } from '@core/auth/clear-composer-storage';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { InputSnapshot } from '../../Input';
import { currentReplyDraft, replyDraftKeys } from '../reply-drafts';
import { ThreadReplyChannelInput } from '../ThreadReplyChannelInput';

const input = vi.hoisted(() => ({
  onSend: undefined as ((snapshot: InputSnapshot) => void) | undefined,
  send: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: () => 'message-id',
  useSendMessageMutation: () => ({ mutateAsync: input.send }),
}));
vi.mock('@queries/messages/typing', () => ({
  usePostTypingUpdateMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../use-channel-bot-mention-users', () => ({
  useMessageBotMentionUsers: () => () => [],
}));
vi.mock('../../Input', () => ({
  ChannelInput: (props: { onSend: typeof input.onSend }) => {
    input.onSend = props.onSend;
  },
  createInputAttachmentTracker: () => ({
    attachments: () => [],
    setAttachments: vi.fn(),
  }),
}));

afterEach(() => localStorage.clear());

const parent = { type: 'channel' as const, id: 'channel' };
const snapshot = { value: 'reply', mentions: [], attachments: [] };
const storedDraft = () =>
  currentReplyDraft(replyDraftKeys(parent, 'root'), undefined)?.value;

function mountInput() {
  return createRoot((dispose) => {
    ThreadReplyChannelInput({
      parent,
      threadId: 'root',
      replyInputState: () => undefined,
      setReplyInputState: vi.fn(),
      onExit: vi.fn(),
    });
    return dispose;
  });
}

it('restores a failed reply sent after a sign-in the input stayed mounted through', async () => {
  input.send.mockRejectedValueOnce(new Error('send refused'));
  const dispose = mountInput();
  endComposerSession();
  input.onSend?.(snapshot);
  await vi.waitFor(() => expect(storedDraft()).toBe('reply'));
  dispose();
});

it('does not restore a reply the sign-in ended', async () => {
  const answer = Promise.withResolvers<never>();
  input.send.mockReturnValueOnce(answer.promise);
  const dispose = mountInput();
  input.onSend?.(snapshot);
  endComposerSession();
  answer.reject(new Error('send refused'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(storedDraft()).toBeUndefined();
  dispose();
});
