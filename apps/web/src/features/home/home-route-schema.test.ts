import { channelsSearchCodec } from '@app/features/channels-view/channels-route';
import { toChannelTargetRequest } from '@channel/Channel/link';
import { describe, expect, it } from 'vitest';
import { homePreviewLegacyTarget, homePreviewTarget } from './home-route';
import { homePreviewRouteParams } from './home-route-schema';

describe('home preview route params', () => {
  it('opens a DOCX item in the write block', () => {
    expect(
      homePreviewRouteParams.safeParse({ blockType: 'write', previewId: 'doc' })
        .success
    ).toBe(true);
  });

  it('leaves calendar to the calendar route', () => {
    expect(
      homePreviewRouteParams.safeParse({
        blockType: 'calendar',
        previewId: 'id',
      }).success
    ).toBe(false);
  });
});

describe('Home channel target URLs', () => {
  it.each([undefined, ['']])(
    'opens a thread root when the message parameter is %j',
    (messageId) => {
      const decoded = channelsSearchCodec.parse({
        ...(messageId ? { messageId } : {}),
        threadId: ['thread-root'],
      });
      expect(decoded.valid).toBe(true);
      const params = {
        blockType: 'channel' as const,
        previewId: 'conversation',
      };
      const search = { channel: decoded.value, document: { commentId: '' } };
      const inline = homePreviewTarget(params, search);
      expect(toChannelTargetRequest({ ...inline.params })).toEqual({
        kind: 'message',
        messageId: 'thread-root',
        threadId: 'thread-root',
      });
      expect(homePreviewLegacyTarget(params, search)).toEqual({
        type: 'channel',
        id: 'conversation',
        params: {
          channel_message_id: 'thread-root',
          channel_thread_id: 'thread-root',
        },
      });
    }
  );
});
