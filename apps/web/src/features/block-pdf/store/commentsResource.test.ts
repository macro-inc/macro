import type { MessageEvent } from '@service-storage/generated/schemas/messageEvent';
import type { Message } from '@service-storage/messages';
import { describe, expect, it, vi } from 'vitest';
import { changesAnchors } from './commentsResource';

vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
  parseWebsocketPayload: vi.fn(),
}));

const parent = { type: 'document', id: 'document-1' } as const;

function posted(threadId: string | null): MessageEvent {
  return {
    actor: 'user-1',
    parent,
    change: {
      type: 'posted',
      message: { id: 'message-1', parent, thread_id: threadId } as Message,
      mentions: [],
    },
  } as unknown as MessageEvent;
}

describe('changesAnchors', () => {
  it('reloads anchors when a message client posts a root or changes a thread', () => {
    const threadUpdated = {
      actor: 'user-1',
      parent,
      change: { type: 'thread_updated', state: {} },
    } as MessageEvent;

    expect({
      root: changesAnchors(posted(null), 'document-1'),
      reply: changesAnchors(posted('root-1'), 'document-1'),
      threadUpdated: changesAnchors(threadUpdated, 'document-1'),
      otherDocument: changesAnchors(posted(null), 'document-2'),
      malformed: changesAnchors(undefined, 'document-1'),
    }).toEqual({
      root: true,
      reply: false,
      threadUpdated: true,
      otherDocument: false,
      malformed: false,
    });
  });
});
