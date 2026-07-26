import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { describe, expect, it } from 'vitest';
import { getDirectMentionAttachment } from './directMentionAttachment';

describe('getDirectMentionAttachment', () => {
  it('maps call mentions back to their document attachment', () => {
    const mention: ItemMention = {
      itemType: 'call',
      itemId: 'call-id',
    };

    expect(getDirectMentionAttachment(mention)).toEqual({
      entity_id: 'call-id',
      entity_type: 'document',
    });
  });

  it('maps channel mentions without requiring loaded channel state', () => {
    const mention: ItemMention = {
      itemType: 'channel',
      itemId: 'channel-id',
    };

    expect(getDirectMentionAttachment(mention)).toEqual({
      entity_id: 'channel-id',
      entity_type: 'channel',
    });
  });
});
