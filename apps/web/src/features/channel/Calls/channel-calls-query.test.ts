import { NIL_UUID } from '@app/features/soup/filters';
import { describe, expect, it } from 'vitest';
import {
  buildChannelCallsQuery,
  buildChannelCallsSearchRequest,
} from './channel-calls-query';

const CHANNEL_ID = 'channel-1';

describe('buildChannelCallsQuery', () => {
  it('lists calls newest first', () => {
    expect(buildChannelCallsQuery(CHANNEL_ID).params).toEqual({
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    });
  });

  it('scopes callf to the channel and confines every other entity target', () => {
    const { body } = buildChannelCallsQuery(CHANNEL_ID);

    expect(body.callf).toEqual({ l: { ChannelId: CHANNEL_ID } });
    expect(body.df).toEqual({ l: { id: NIL_UUID } });
    expect(body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
    expect(body.chanf).toEqual({ l: { ChannelId: NIL_UUID } });
    expect(body.cthf).toEqual({ l: { ChannelId: NIL_UUID } });
    expect(body.cf).toEqual({ l: { cid: NIL_UUID } });
    expect(body.pf).toEqual({ l: { pid: NIL_UUID } });
    expect(body.calf).toEqual({ l: { id: NIL_UUID } });
    expect(body.fef).toEqual({ l: { id: NIL_UUID } });
    expect(body.ccf).toEqual({ l: { id: NIL_UUID } });
    expect(body.asf).toEqual({ l: { id: NIL_UUID } });
    expect(body.remf).toEqual({ l: { id: NIL_UUID } });
  });
});

describe('buildChannelCallsSearchRequest', () => {
  it('searches call names and transcripts in this channel only', () => {
    const { body } = buildChannelCallsSearchRequest(CHANNEL_ID, {
      query: 'standup',
      matchType: 'partial',
    });

    expect(body.query).toBe('standup');
    expect(body.match_type).toBe('partial');
    expect(body.search_on).toBe('name_content');
    expect(body.filters?.call_filters).toEqual({ channel_ids: [CHANNEL_ID] });
    expect(body.filters?.document_filters).toEqual({
      document_ids: [NIL_UUID],
    });
    expect(body.filters?.email_filters).toEqual({
      email_thread_ids: [NIL_UUID],
    });
    expect(body.filters?.channel_filters).toEqual({
      channel_ids: [NIL_UUID],
    });
  });
});
