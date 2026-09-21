import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requests = vi.hoisted(() => ({
  authenticated: vi.fn(),
  public: vi.fn(),
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'https://gateway.example/dss' },
}));
vi.mock('@core/util/fetchWithToken', () => ({
  fetchWithToken: requests.authenticated,
}));
vi.mock('@core/util/safeFetch', () => ({ safeFetch: requests.public }));

import { callServiceClient } from './client';

beforeEach(() => {
  vi.clearAllMocks();
  requests.authenticated.mockResolvedValue(ok({}));
  requests.public.mockResolvedValue(ok({}));
});

describe('meeting transport authorization', () => {
  it.each([
    [400, 'Bad request: Invalid channel ID format', 'MEETINGS_UNAVAILABLE'],
    [400, 'Bad request: Invalid title', 'HTTP_ERROR'],
    [403, 'Forbidden', 'FORBIDDEN'],
    [500, 'Internal error', 'SERVER_ERROR'],
  ])(
    'classifies the meeting list response %s / %s',
    async (status, message, code) => {
      requests.authenticated.mockResolvedValue(ok({ meetings: [] }));
      await callServiceClient.getMeetings();
      const [url, options] = requests.authenticated.mock.calls[0];
      expect(url).toBe('https://gateway.example/dss/call/meetings');
      const error = await options.errorResponseHandler(
        new Response(JSON.stringify({ message }), { status })
      );
      expect(error.code).toBe(code);
    }
  );
  it('requires a signed-in sender for guest invitations and sends the email to the call endpoint', async () => {
    await callServiceClient.inviteToMeeting('secret', 'guest@outside.example');
    expect(requests.authenticated).toHaveBeenCalledWith(
      'https://gateway.example/dss/call/meetings/invite/secret',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'guest@outside.example' }),
      }
    );
    expect(requests.public).not.toHaveBeenCalled();
  });
  it('loads public metadata without Macro session credentials', async () => {
    await callServiceClient.getMeeting('secret');
    expect(requests.public).toHaveBeenCalledWith(
      'https://gateway.example/dss/call/join/secret',
      { credentials: 'omit' }
    );
    expect(requests.authenticated).not.toHaveBeenCalled();
  });
  it('joins guests with only their display name and no session credentials', async () => {
    await callServiceClient.joinMeetingAsGuest('secret', 'Taylor');
    expect(requests.public).toHaveBeenCalledWith(
      'https://gateway.example/dss/call/join/secret',
      {
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify({ displayName: 'Taylor' }),
      }
    );
    expect(requests.authenticated).not.toHaveBeenCalled();
  });
  it('keeps signed-in joins on the authenticated endpoint', async () => {
    await callServiceClient.joinMeeting('secret');
    expect(requests.authenticated).toHaveBeenCalledWith(
      'https://gateway.example/dss/call/meetings/join/secret',
      { method: 'POST' }
    );
    expect(requests.public).not.toHaveBeenCalled();
  });
  it('leaves with the scoped room token and never account credentials', async () => {
    await callServiceClient.leaveMeeting('secret', 'scoped-room-token');
    expect(requests.public).toHaveBeenCalledWith(
      'https://gateway.example/dss/call/join/secret/leave',
      {
        method: 'POST',
        credentials: 'omit',
        headers: { Authorization: 'Bearer scoped-room-token' },
      }
    );
    expect(requests.authenticated).not.toHaveBeenCalled();
  });
});
