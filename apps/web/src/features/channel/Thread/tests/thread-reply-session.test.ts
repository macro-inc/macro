import { endComposerSession } from '@core/auth/clear-composer-storage';
import { setAccountSession } from '@queries/auth/account-session';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { InputSnapshot } from '../../Input';
import { currentReplyDraft, replyDraftKeys } from '../reply-drafts';
import { ThreadReplyChannelInput } from '../ThreadReplyChannelInput';

const input = vi.hoisted(() => ({
  onSend: undefined as ((snapshot: InputSnapshot) => void) | undefined,
  send: vi.fn(),
  userId: 'viewer',
  handled: [] as Promise<unknown>[],
}));
// What the input started and did not wait for: done once it has decided
// whether to restore a failed reply.
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: Promise<unknown>, surface: string) => {
    if (surface === 'thread-reply-input') input.handled.push(work);
  },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => input.userId }));
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

afterEach(() => {
  localStorage.clear();
  setAccountSession({ epoch: 0, pending: false });
  queryClient.clear();
  input.userId = 'viewer';
  input.handled = [];
});

/** Once the input has dealt with every reply it sent. */
const handled = () => Promise.all(input.handled);

/** Once the input has been told that the reply it sent last failed. */
const refused = () =>
  expect(input.send.mock.results.at(-1)?.value).rejects.toThrow();

/** A sign-in that has not said who signed in yet; returned, says so. */
function signIn() {
  endComposerSession();
  setAccountSession({ epoch: 1, pending: true });
  return (id: string) => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id,
      authenticated: true,
    });
    setAccountSession({ epoch: 1, pending: false });
  };
}

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
  await handled();
  expect(storedDraft()).toBe('reply');
  dispose();
});

it('does not restore a reply the sign-in ended', async () => {
  const answer = Promise.withResolvers<never>();
  input.send.mockReturnValueOnce(answer.promise);
  const dispose = mountInput();
  input.onSend?.(snapshot);
  endComposerSession();
  answer.reject(new Error('send refused'));
  await handled();
  expect(storedDraft()).toBeUndefined();
  dispose();
});

it('restores nothing of the user before a sign-in that says who signed in late', async () => {
  input.send.mockRejectedValueOnce(new Error('send refused'));
  const dispose = mountInput();
  const proven = signIn();
  input.onSend?.(snapshot);
  await refused();
  expect(storedDraft()).toBeUndefined();
  // The app shows the user before it until its query publishes the new one.
  proven('someone-else');
  await handled();
  expect(storedDraft()).toBeUndefined();
  dispose();
});

it('restores nothing of the user before a sign-in that said who signed in before the send failed', async () => {
  const answer = Promise.withResolvers<never>();
  input.send.mockReturnValueOnce(answer.promise);
  const dispose = mountInput();
  const proven = signIn();
  input.onSend?.(snapshot);
  proven('someone-else');
  answer.reject(new Error('send refused'));
  await handled();
  expect(storedDraft()).toBeUndefined();
  dispose();
});

it('restores a failed reply once the sign-in says the same user signed in', async () => {
  input.send.mockRejectedValueOnce(new Error('send refused'));
  const dispose = mountInput();
  const proven = signIn();
  input.onSend?.(snapshot);
  await refused();
  expect(storedDraft()).toBeUndefined();
  proven('viewer');
  await handled();
  expect(storedDraft()).toBe('reply');
  dispose();
});
