import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onMount } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelHandle } from '../Channel';
import {
  ChannelMessages,
  ChannelSurface,
  type ChannelTargetRequest,
} from '../ChannelSurface';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  mount: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@queries/messages/timeline', () => ({
  fetchResolvedChannelMessage: mocks.resolve,
  findThreadIdInMessageTimeline: () => undefined,
  findTopLevelMessageInMessageTimeline: () => undefined,
}));
vi.mock('../Channel', () => ({
  Channel: (props: {
    targetMessageId?: string;
    targetMessageReplyId?: string;
    onHandleReady: (handle: Partial<ChannelHandle>) => void;
  }) => {
    mocks.mount(props.targetMessageId, props.targetMessageReplyId);
    onMount(() =>
      props.onHandleReady({
        goToMessage: mocks.navigate,
        getMessagesStateSnapshot: () => undefined,
      })
    );
    return (
      <div>
        <p>{props.targetMessageReplyId ?? props.targetMessageId ?? 'Latest'}</p>
        <input aria-label="Message" />
      </div>
    );
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function deferredMessage() {
  let resolve!: (message: { kind: string; thread_id: string }) => void;
  const promise = new Promise<{ kind: string; thread_id: string }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('channel message link startup', () => {
  it('waits for an unknown reply before mounting its first message window', async () => {
    const message = deferredMessage();
    mocks.resolve.mockReturnValue(message.promise);
    render(() => (
      <ChannelSurface
        channelId="channel-1"
        targetRequest={{ kind: 'message', messageId: 'reply-1' }}
      >
        <ChannelMessages />
      </ChannelSurface>
    ));

    expect(screen.getByRole('status').textContent).toBe('Loading conversation');
    expect(mocks.mount).not.toHaveBeenCalled();
    expect(screen.queryByText('Latest')).toBeNull();

    message.resolve({ kind: 'thread_reply', thread_id: 'root-1' });
    await screen.findByText('reply-1');
    expect(mocks.mount).toHaveBeenCalledExactlyOnceWith('root-1', 'reply-1');
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { messageId: 'root-1', threadId: 'root-1', replyId: undefined },
    { messageId: 'reply-1', threadId: 'root-1', replyId: 'reply-1' },
  ])(
    'opens a known target without a resolution request: $messageId',
    (target) => {
      render(() => (
        <ChannelSurface
          channelId="channel-1"
          targetRequest={{ kind: 'message', ...target }}
        >
          <ChannelMessages />
        </ChannelSurface>
      ));
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.mount).toHaveBeenCalledExactlyOnceWith(
        'root-1',
        target.replyId
      );
      expect(screen.getByText(target.messageId)).toBeTruthy();
    }
  );

  it('lets a newer target replace an unresolved launch target', async () => {
    const oldMessage = deferredMessage();
    mocks.resolve.mockReturnValue(oldMessage.promise);
    render(() => {
      const [target, setTarget] = createSignal<ChannelTargetRequest>({
        kind: 'message',
        messageId: 'old-reply',
      });
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setTarget({
                kind: 'message',
                messageId: 'new-root',
                threadId: 'new-root',
              })
            }
          >
            Open newer notification
          </button>
          <ChannelSurface channelId="channel-1" targetRequest={target()}>
            <ChannelMessages />
          </ChannelSurface>
        </>
      );
    });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('new-root')).toBeTruthy();
    oldMessage.resolve({ kind: 'thread_reply', thread_id: 'old-root' });
    await oldMessage.promise;
    await Promise.resolve();
    expect(mocks.mount).toHaveBeenCalledExactlyOnceWith('new-root', undefined);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps a mounted composer while resolving another message link', async () => {
    const message = deferredMessage();
    mocks.resolve.mockReturnValue(message.promise);
    render(() => {
      const [target, setTarget] = createSignal<ChannelTargetRequest>({
        kind: 'message',
        messageId: 'root-1',
        threadId: 'root-1',
      });
      return (
        <>
          <button
            type="button"
            onClick={() => setTarget({ kind: 'message', messageId: 'reply-2' })}
          >
            Open another message
          </button>
          <ChannelSurface channelId="channel-1" targetRequest={target()}>
            <ChannelMessages />
          </ChannelSurface>
        </>
      );
    });
    const composer = screen.getByRole('textbox');
    fireEvent.input(composer, { target: { value: 'Unsent draft' } });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('textbox')).toBe(composer);
    expect(screen.queryByRole('status')).toBeNull();

    message.resolve({ kind: 'thread_reply', thread_id: 'root-2' });
    await message.promise;
    await Promise.resolve();
    expect(mocks.navigate).toHaveBeenCalledWith('root-2', 'reply-2');
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toBe(composer);
    expect(composer).toHaveProperty('value', 'Unsent draft');
  });
});
