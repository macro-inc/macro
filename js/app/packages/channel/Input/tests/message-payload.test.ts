import { STATIC_IMAGE, STATIC_VIDEO } from '@core/store/cacheChannelInput';
import { describe, expect, it } from 'vitest';
import { buildPostMessageRequest } from '../message-payload';

describe('buildPostMessageRequest', () => {
  it('maps mentions and attachments into the comms payload shape', () => {
    const payload = buildPostMessageRequest(
      {
        value: 'hello',
        mentions: [
          { itemId: 'user-1', itemType: 'user' },
          { itemId: 'channel-1', itemType: 'channel' },
        ],
        attachments: [
          { id: 'img-1', name: 'image.png', kind: 'image' },
          { id: 'vid-1', name: 'clip.mp4', kind: 'video' },
          { id: 'doc-1', name: 'spec', kind: 'document' },
        ],
      },
      'thread-1'
    );

    expect(payload).toEqual({
      content: 'hello',
      thread_id: 'thread-1',
      mentions: [
        { entity_id: 'user-1', entity_type: 'user' },
        { entity_id: 'channel-1', entity_type: 'channel' },
      ],
      attachments: [
        { entity_id: 'img-1', entity_type: STATIC_IMAGE },
        { entity_id: 'vid-1', entity_type: STATIC_VIDEO },
        { entity_id: 'doc-1', entity_type: 'document' },
      ],
    });
  });
});
