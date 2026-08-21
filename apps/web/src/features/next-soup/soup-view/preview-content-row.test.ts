import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { withPreviewSourceEntityId } from '../preview-history';
import { previewContentMatchesEntity } from './preview-content-row';

const channelMessage = (messageId: string): EntityData =>
  ({
    type: 'channel_message',
    id: `channel-1:${messageId}`,
    channelId: 'channel-1',
    messageId,
  }) as EntityData;

const channelThread = (threadId: string): EntityData =>
  ({
    type: 'channel_thread',
    id: threadId,
    channelId: 'channel-1',
    messageId: threadId,
    threadId,
  }) as EntityData;

describe('previewContentMatchesEntity', () => {
  it('prefers the stamped source row after history removes channel params', () => {
    const channel = { type: 'channel', id: 'channel-1' } as EntityData;
    const origin = channelThread('thread-2');
    const content = withPreviewSourceEntityId(
      { type: 'channel', id: 'channel-1' },
      origin.id
    );

    expect(
      [channel, origin].find((entity) =>
        previewContentMatchesEntity(content, entity)
      )
    ).toBe(origin);
  });

  it('retains direct entity id matching', () => {
    const entity = { id: 'document-1' } as EntityData;

    expect(
      previewContentMatchesEntity({ type: 'md', id: 'document-1' }, entity)
    ).toBe(true);
  });

  it('uses the message param to disambiguate rows from the same channel', () => {
    const other = channelMessage('message-1');
    const origin = channelMessage('message-2');
    const content: SplitContent = {
      type: 'channel',
      id: 'channel-1',
      params: { channel_message_id: 'message-2' },
    };

    expect(
      [other, origin].find((entity) =>
        previewContentMatchesEntity(content, entity)
      )
    ).toBe(origin);
  });

  it('uses the thread param to resolve the originating notification row', () => {
    const other = channelThread('thread-1');
    const origin = channelThread('thread-2');
    const content: SplitContent = {
      type: 'channel',
      id: 'channel-1',
      params: {
        channel_message_id: 'reply-2',
        channel_thread_id: 'thread-2',
      },
    };

    expect(
      [other, origin].find((entity) =>
        previewContentMatchesEntity(content, entity)
      )
    ).toBe(origin);
  });
});
