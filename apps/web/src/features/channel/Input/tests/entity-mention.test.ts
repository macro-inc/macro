import type {
  ChannelEntity,
  ChannelMessageEntity,
  DocumentEntity,
  EntityData,
} from '@entity';
import { describe, expect, it, vi } from 'vitest';
import { entityToDocumentMentionInfo } from '../utils/entity-mention';

vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (entity: EntityData) => {
    if (entity.type === 'document') {
      return entity.fileType === 'md' ? 'md' : 'unknown';
    }
    if (entity.type === 'channel' || entity.type === 'channel_message') {
      return 'channel';
    }
    return entity.type;
  },
}));

const base = {
  ownerId: 'owner-1',
};

describe('entityToDocumentMentionInfo', () => {
  it('builds a document mention for a document entity', () => {
    const entity: DocumentEntity = {
      ...base,
      type: 'document',
      id: 'doc-1',
      name: 'My Doc',
      fileType: 'md',
    };

    expect(entityToDocumentMentionInfo(entity)).toEqual({
      documentId: 'doc-1',
      documentName: 'My Doc',
      blockName: 'md',
      channelType: undefined,
    });
  });

  it('builds a channel mention deep-linked to the message and thread', () => {
    const entity: ChannelMessageEntity = {
      ...base,
      type: 'channel_message',
      id: 'channel-1:msg-1',
      name: 'feature-requests',
      channelId: 'channel-1',
      channelName: 'feature-requests',
      channelType: 'public',
      messageId: 'msg-1',
      threadId: 'thread-1',
      senderId: 'sender-1',
      content: 'hello',
    };

    expect(entityToDocumentMentionInfo(entity)).toEqual({
      documentId: 'channel-1',
      documentName: 'feature-requests',
      blockName: 'channel',
      blockParams: {
        channel_message_id: 'msg-1',
        channel_thread_id: 'thread-1',
      },
      channelType: 'public',
    });
  });

  it('omits the thread param when a channel message has no thread', () => {
    const entity: ChannelMessageEntity = {
      ...base,
      type: 'channel_message',
      id: 'channel-1:msg-1',
      name: 'feature-requests',
      channelId: 'channel-1',
      channelName: 'feature-requests',
      channelType: 'public',
      messageId: 'msg-1',
      senderId: 'sender-1',
      content: 'hello',
    };

    const info = entityToDocumentMentionInfo(entity);
    expect(info?.blockParams).toEqual({ channel_message_id: 'msg-1' });
  });

  it('returns undefined when the entity has no recognizable block', () => {
    const entity: DocumentEntity = {
      ...base,
      type: 'document',
      id: 'doc-1',
      name: 'Mystery',
      fileType: 'not-a-real-file-type',
    };

    expect(entityToDocumentMentionInfo(entity)).toBeUndefined();
  });

  it('carries the channel type for a channel entity', () => {
    const entity: ChannelEntity = {
      ...base,
      type: 'channel',
      id: 'channel-1',
      name: 'feature-requests',
      channelType: 'private',
    };

    expect(entityToDocumentMentionInfo(entity)).toEqual({
      documentId: 'channel-1',
      documentName: 'feature-requests',
      blockName: 'channel',
      channelType: 'private',
    });
  });
});
