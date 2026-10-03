import { agentDetailSearchCodec } from '@app/features/block-agent/agent-route';
import { callDetailSearchCodec } from '@app/features/block-call/call-route';
import { markdownDetailSearchCodec } from '@app/features/block-md/markdown-route';
import { pdfDetailSearchCodec } from '@app/features/block-pdf/pdf-route';
import { channelsSearchCodec } from '@app/features/channels-view/channels-route';
import { emailDetailSearchCodec } from '@app/features/email-view/email-route';
import { parsePaneSearch } from '@app/lib/split-router/next/routes/search';
import { replacePaneSearchParams } from '@app/split-router';
import type { SearchLocation } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  searchLocationTarget,
  searchLocationUpdates,
} from './search-navigation';

describe('search target URLs', () => {
  const locations: SearchLocation[] = [
    { type: 'channel', messageId: 'reply', threadId: 'parent' },
    { type: 'email', messageId: 'old-message' },
    { type: 'md', nodeId: 'node-1' },
    {
      type: 'pdf',
      searchPage: 3,
      highlightTerms: ['one two', '日本語'],
      searchSnippet: 'one two & 日本語',
      searchRawQuery: 'one two',
    },
    { type: 'agent', messageTurn: 0, author: 'agent' },
    { type: 'call_record', callId: 'call', transcriptId: 'segment' },
  ];

  it.each(locations)(
    'round-trips every field of $type through pane-local URL search',
    (location) => {
      const target = searchLocationTarget('entity', location, 'request');
      const query = new URLSearchParams();
      replacePaneSearchParams(query, [{ [target.namespace]: target.params }]);
      const restored = parsePaneSearch(query.toString())[0]?.[target.namespace];
      const codecs = {
        channel: channelsSearchCodec,
        email: emailDetailSearchCodec,
        md: markdownDetailSearchCodec,
        pdf: pdfDetailSearchCodec,
        agent: agentDetailSearchCodec,
        call_record: callDetailSearchCodec,
      };
      const parsed = codecs[location.type].parse(restored);
      expect(parsed.valid).toBe(true);
      expect(parsed.value).toMatchObject({ seek: 'request' });
      expect(restored).toEqual(target.params);
      if (location.type === 'pdf')
        expect(parsed.value).toEqual({
          documentId: 'entity',
          page: 3,
          highlightTerms: ['one two', '日本語'],
          snippet: 'one two & 日本語',
          query: 'one two',
          seek: 'request',
        });
      if (location.type === 'agent')
        expect(parsed.value).toMatchObject({ messageTurn: 0, author: 'agent' });
    }
  );

  it('clears the previous thread while preserving the selected Chat tab', () => {
    const patch = searchLocationUpdates('entity', {
      type: 'channel',
      messageId: 'root',
    }).channels;
    expect(typeof patch).toBe('function');
    if (typeof patch !== 'function')
      throw new Error('Expected a field-preserving update');
    expect(
      patch({
        tab: ['recents'],
        messageId: ['old'],
        threadId: ['old-parent'],
        seek: ['old-request'],
      })
    ).toEqual({
      tab: ['recents'],
      messageId: ['root'],
      seek: [expect.any(String)],
    });
  });

  it('assigns independent requests to repeated clicks on the same location', () => {
    const location: SearchLocation = { type: 'email', messageId: 'message' };
    expect(searchLocationTarget('entity', location).params.seek).not.toEqual(
      searchLocationTarget('entity', location).params.seek
    );
  });
});
