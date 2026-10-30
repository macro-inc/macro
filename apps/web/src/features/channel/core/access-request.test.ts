import type { ChannelAccessRequest } from '@service-storage/generated/schemas/channelAccessRequest';
import { expect, it } from 'vitest';
import { requestToJoinView } from './access-request';

const request = (
  status: ChannelAccessRequest['status']
): ChannelAccessRequest => ({
  id: 'request-1',
  channel_id: 'channel-1',
  requester_id: 'macro|outsider@example.com',
  status,
  created_at: '2026-10-21T12:00:00Z',
});

it('lets people ask again after an approval from before they left', () => {
  expect(
    requestToJoinView({ can_request: true, request: request('approved') })
  ).toEqual({ kind: 'ask' });
});

it('tells a denied requester when they may ask again', () => {
  expect(
    requestToJoinView({
      can_request: true,
      request: request('denied'),
      retry_after: '2026-10-22T12:00:00Z',
    })
  ).toEqual({ kind: 'denied', retryAfter: '2026-10-22T12:00:00Z' });
  expect(
    requestToJoinView({
      can_request: true,
      request: request('cancelled'),
      retry_after: '2026-10-21T12:01:00Z',
    })
  ).toEqual({ kind: 'wait', retryAfter: '2026-10-21T12:01:00Z' });
});

it('offers nothing in channels that do not take requests', () => {
  expect(
    requestToJoinView({ can_request: false, request: request('pending') })
  ).toBeUndefined();
});
