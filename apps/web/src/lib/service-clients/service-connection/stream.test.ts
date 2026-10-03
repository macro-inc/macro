import type { ChatStream } from '@service-cognition/generated/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SocketMessage = { type: string; data: string };

const mocks = vi.hoisted(() => ({
  onMessage: undefined as ((message: SocketMessage) => void) | undefined,
}));

// The real module opens the gateway socket at import time.
vi.mock('./websocket', () => ({
  createConnectionWebsocketEffect: (
    callback: (message: SocketMessage) => void
  ) => {
    mocks.onMessage = callback;
  },
}));

import {
  clearStream,
  getEntityStreams,
  markStreamsAwaitingReplay,
} from './stream';

const CHAT_ID = 'chat-1';
const STREAM_ID = 'stream-1';

function text(text: string): ChatStream {
  return {
    type: 'chat_message_response',
    stream_id: STREAM_ID,
    chat_id: CHAT_ID,
    message_id: STREAM_ID,
    content: { type: 'text', text },
  };
}

const end: ChatStream = { type: 'stream_end', stream_id: STREAM_ID };

/** Deliver one stream item as the gateway would over the socket. */
function receive(payload: ChatStream) {
  mocks.onMessage!({
    type: 'stream',
    data: JSON.stringify({
      id: { entity_type: 'chat', entity_id: CHAT_ID, stream_id: STREAM_ID },
      payload,
    }),
  });
}

function texts() {
  const [stream] = getEntityStreams('chat', CHAT_ID)();
  return stream
    .data()
    .map((item) => (item.type === 'chat_message_response' ? item : undefined))
    .map((item) => (item?.content.type === 'text' ? item.content.text : '?'));
}

beforeEach(() => {
  clearStream(CHAT_ID);
});

describe('stream store: items over the socket', () => {
  it('appends items to the stream and ends it on stream_end', () => {
    receive(text('a'));
    receive(text('b'));
    expect(texts()).toEqual(['a', 'b']);

    const [stream] = getEntityStreams('chat', CHAT_ID)();
    expect(stream.isDone()).toBe(false);
    receive(end);
    expect(stream.isDone()).toBe(true);
  });
});

describe('stream store: replay after the socket reconnects', () => {
  it('starts a fresh copy of an open stream instead of appending the replay', () => {
    receive(text('a'));
    receive(text('b'));
    const [before] = getEntityStreams('chat', CHAT_ID)();

    markStreamsAwaitingReplay();
    // The gateway replays the stream from its first item.
    receive(text('a'));
    receive(text('b'));
    receive(text('c'));
    receive(end);

    const [after] = getEntityStreams('chat', CHAT_ID)();
    expect(after).not.toBe(before);
    expect(texts()).toEqual(['a', 'b', 'c']);
    expect(after.isDone()).toBe(true);
    // The copy from before the drop is left as it was.
    expect(before.isDone()).toBe(false);
    expect(before.data()).toHaveLength(2);
  });

  it('leaves a finished stream alone when its replay arrives', () => {
    receive(text('a'));
    receive(end);
    const [stream] = getEntityStreams('chat', CHAT_ID)();

    markStreamsAwaitingReplay();
    receive(text('a'));
    receive(end);

    expect(getEntityStreams('chat', CHAT_ID)()).toEqual([stream]);
    expect(texts()).toEqual(['a']);
  });

  it('keeps appending when no reconnect happened', () => {
    receive(text('a'));
    receive(text('b'));
    expect(texts()).toEqual(['a', 'b']);
  });
});
