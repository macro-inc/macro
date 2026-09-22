import { print } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  SoupDocument,
} from './generated/graphql';

describe('channel list projection', () => {
  it.each([ChannelListSoupDocument, ChannelListItemFieldsFragmentDoc])(
    'omits historical send presentation in both query and local reconciliation',
    (document) => {
      const query = print(document);
      for (const field of [
        'channelMessageSendMessageContent',
        'channelMessageSendSenderDisplayName',
        'channelMessageSendSenderProfilePictureUrl',
        'channelMessageSendChannelName',
      ]) {
        expect(query).not.toContain(field);
        expect(print(SoupDocument)).toContain(field);
      }
      for (const field of [
        'notifications',
        'state',
        'createdAt',
        'viewedAt',
        'updatedAt',
        'senderId',
        'channelMessageSendMessageId',
        'channelMentionMessageId',
        'channelMentionThreadId',
        'channelReplyMessageId',
        'channelReplyThreadId',
        'latestMessage',
        'latestNonThreadMessage',
        'mentions',
        'content',
      ]) {
        expect(query).toContain(field);
      }
    }
  );
});
