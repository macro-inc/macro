import { afterEach, expect, test } from 'bun:test';
import { inspect } from 'node:util';
import {
  AlreadyConnectedError,
  CallEndedError,
  InOtherCallError,
  Macro,
} from '../src/macro';
import { MacroClient } from '../src/utils/client';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Route = (request: Request) => Response | Promise<Response>;

function serve(routes: Record<string, Route>): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      const key = `${request.method} ${new URL(request.url).pathname}`;
      const route = routes[key];
      if (!route) throw new Error(`Unexpected route ${key}`);
      return route(request);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

function macro() {
  return new Macro({
    auth: { type: 'user', apiKey: 'test_key' },
    hosts: { storage: 'https://storage.test' },
  });
}

const credential = {
  callId: 'call-1',
  participantId: 'user-1',
  roomName: 'room-1',
  serverUrl: 'wss://room.test',
  token: 'private-room-token',
  started: false,
};

test('channel checks active without creating and starts with a body', async () => {
  const requests = serve({
    'GET /call/channel-1/active': () => new Response(null, { status: 204 }),
    'POST /call/channel-1': () =>
      Response.json({ ...credential, started: true }),
    'POST /call/record/call-1/leave': () =>
      Response.json({ callEnded: false }),
  });
  const channel = macro().channels.byId('channel-1');
  expect(await channel.activeCall()).toBeUndefined();
  const connection = await channel.startCall({ onOtherCall: 'fail' });
  expect(connection.started).toBe(true);
  expect(await requests[1]?.json()).toEqual({ onOtherCall: 'fail' });
  expect(await connection.leave()).toEqual({ callEnded: false });
  expect(requests.map((request) => request.method)).toEqual([
    'GET',
    'POST',
    'POST',
  ]);
  expect(JSON.stringify(connection)).not.toContain(credential.token);
  expect(inspect(connection)).not.toContain(credential.token);
});

test('call joins by record id and maps admission failures', async () => {
  const call = macro().calls.byId('call-1');
  serve({
    'POST /call/record/call-1/join': () => Response.json(credential),
  });
  expect((await call.join({ replace: true })).identity).toBe('user-1');

  for (const [status, body, expected] of [
    [409, { code: 'in_other_call', message: 'busy' }, InOtherCallError],
    [409, { code: 'already_connected', message: 'connected' }, AlreadyConnectedError],
    [410, { message: 'ended' }, CallEndedError],
  ] as const) {
    serve({
      'POST /call/record/call-1/join': () => Response.json(body, { status }),
    });
    await expect(call.join()).rejects.toBeInstanceOf(expected);
  }
});

test('live list, ring, roster, decline and recording use call-id routes', async () => {
  serve({
    'GET /call/active/all': () =>
      Response.json({
        calls: [{
          callId: 'call-1',
          kind: 'channel',
          channelId: 'channel-1',
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: 'user-1',
          participantCount: 1,
          ringing: true,
        }],
      }),
    'POST /call/record/preview': () =>
      Response.json({
        previews: [{
          type: 'exists',
          callId: 'call-1',
          channelId: 'channel-1',
          customName: 'Call',
          startedAt: '2026-01-01T00:00:00Z',
        }],
      }),
    'GET /call/record/call-1/ring': () =>
      Response.json({ status: 'ringing' }),
    'GET /call/record/call-1/participants': () =>
      Response.json({
        participants: [{
          identity: 'user-1',
          displayName: 'Program',
          kind: 'user',
          userId: 'user-1',
          isProgram: true,
          tracks: [{ source: 'microphone', muted: false }],
        }],
      }),
    'POST /call/record/call-1/decline': () =>
      new Response(null, { status: 204 }),
    'GET /call/record/call-1/recording': () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'video/mp4' },
      }),
  });
  const sdk = macro();
  const [call] = await sdk.calls.active();
  expect(call?.kind).toBe('channel');
  expect((await sdk.calls.summaries([call!]))[0]?.customName).toBe('Call');
  expect(await call!.ringState()).toBe('ringing');
  const [participant] = await call!.participants();
  expect(participant?.user?.id).toBe('user-1');
  expect(participant?.tracks[0]?.source).toBe('microphone');
  await call!.decline();
  expect(await call!.recording.bytes()).toEqual(new Uint8Array([1, 2, 3]));
});

test('meeting account and guest joins use the invitation link', async () => {
  const requests = serve({
    'GET /call/meetings': () =>
      Response.json({ meetings: [{ id: 'meeting-1', shareToken: 'share-1' }] }),
    'POST /call/meetings/join/share-1': () => Response.json(credential),
    'POST /call/join/share-1': () => Response.json(credential),
  });
  const meeting = macro().meetings.byId('meeting-1');
  await meeting.join();
  await meeting.joinAsGuest('Guest');
  expect(await requests[1]?.json()).toEqual({});
  expect(await requests[2]?.json()).toEqual({ displayName: 'Guest' });
});

test('discussion follows the record location', async () => {
  serve({
    'GET /call/record/call-1': () =>
      Response.json({
        discussion: {
          kind: 'channel_thread',
          channel_id: 'channel-1',
          root_id: 'message-1',
        },
      }),
  });
  const thread = await macro().calls.byId('call-1').discussion();
  expect(thread.toJSON()).toEqual({
    channelId: 'channel-1',
    rootId: 'message-1',
  });
});

test('call notifications hydrate entity handles', async () => {
  const { hydrateCallEvent } = await import('../src/events/hydrate/call');
  const client = new MacroClient({
    auth: { type: 'user', apiKey: 'test_key' },
    hosts: { storage: 'https://storage.test' },
  });
  const event = hydrateCallEvent(client, {
    event_type: 'call.invited',
    metadata: {
      call_id: 'call-1',
      meeting_id: 'meeting-1',
      invited_by: 'user-1',
    },
  });
  expect(event.call.id).toBe('call-1');
  expect(event.meeting?.id).toBe('meeting-1');
  expect(event.inviter?.id).toBe('user-1');
});

test('call previews preserve input order and omit missing records', async () => {
  const requests = serve({
    'POST /call/record/preview': () =>
      Response.json({
        previews: [
          { type: 'exists', callId: 'call-2', startedAt: '2026-01-02T00:00:00Z' },
          { type: 'does_not_exist', callId: 'call-3' },
          { type: 'exists', callId: 'call-1', startedAt: '2026-01-01T00:00:00Z' },
        ],
      }),
  });
  const sdk = macro();
  const summaries = await sdk.calls.summaries([
    sdk.calls.byId('call-1'),
    sdk.calls.byId('call-2'),
    sdk.calls.byId('call-3'),
  ]);
  expect(summaries.map(({ call }) => call.id)).toEqual(['call-1', 'call-2']);
  expect(await requests[0]?.json()).toEqual({
    callIds: ['call-1', 'call-2', 'call-3'],
  });
});
