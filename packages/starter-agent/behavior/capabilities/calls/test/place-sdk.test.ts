/**
 * Placing a call through the real SDK, with only the network faked: every
 * request names real ids, and the call is started in the DM it opened.
 */
import { afterEach, expect, test } from 'bun:test';
import { Macro } from '@macro-inc/sdk';
import { Temporal } from 'temporal-polyfill';
import { idList, ledger } from '../ledger.ts';
import { sdkCalls } from '../macro.ts';
import { macroPlaceFacts, placeCall } from '../place.ts';
import { type NewPlaceRow, PlaceRow } from '../types.ts';

const agent = 'macro|james@agents.example.com';
const owner = 'macro|owner@example.com';
const dm = '0190a3c4-0000-7000-8000-0000000000d1';
const asked = '0190a3c4-0000-7000-8000-0000000000a1';
const call = '0190a3c4-0000-7000-8000-0000000000c1';
const now = Temporal.Now.instant();

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Macro, as far as placing a call asks it; every request is recorded. */
const fakeMacro = (requests: string[]) => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const line = `${init?.method ?? request?.method ?? 'GET'} ${url.pathname}`;
    requests.push(line);
    if (line === 'GET /auth/user/me') return json({ user_id: agent });
    if (line === `GET /dss/messages/channel/${dm}/items/${asked}`)
      return json({
        id: asked,
        sender_id: owner,
        content: 'can you call me',
        created_at: now.toString(),
      });
    if (line === `GET /dss/channels/${dm}`)
      return json({ channel_type: 'direct_message', name: '' });
    if (line === 'POST /dss/channels/get_or_create_dm')
      return json({ channel_id: dm });
    if (line === `POST /dss/call/${dm}`)
      return json({
        callId: call,
        roomName: `room-${call}`,
        serverUrl: 'wss://livekit.example.com',
        token: 't',
        participantId: agent,
        started: true,
      });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
};

const memoryDisk = () => {
  const files = new Map<string, string>();
  return {
    read: async (path: string) => files.get(path),
    append: async (path: string, text: string) => {
      files.set(path, `${files.get(path) ?? ''}${text}`);
    },
    write: async (path: string, text: string) => {
      files.set(path, text);
    },
  };
};

test("the owner's 'call me' in a DM places the call, with real ids in every request", async () => {
  const requests: string[] = [];
  fakeMacro(requests);
  const macro = new Macro({ auth: { type: 'user', apiKey: 'mak_test' } });
  const api = sdkCalls({
    macro: async () => macro,
    connectRoom: async () => {
      throw new Error('no room in this test');
    },
    publishScreen: async () => {
      throw new Error('no screen in this test');
    },
  });
  const disk = memoryDisk();
  const clock = { now: () => Temporal.Now.instant() };
  const outcome = await placeCall(
    {
      target: owner,
      reason: 'You asked me to call.',
      message: { channel: dm, id: asked },
    },
    {
      ...macroPlaceFacts(api),
      owner,
      clock,
      rows: ledger<PlaceRow, NewPlaceRow>({
        file: 'outbound.jsonl',
        schema: PlaceRow,
        disk,
        clock,
      }),
      noCall: idList({ file: 'no-call.json', disk }),
      lock: async () => ({ release: () => {} }),
      suffix: () => 'abc',
    }
  );
  expect(outcome).toMatchObject({ ok: true, rule: 'owner-order' });
  const seated = await api.join({ kind: 'channel', id: dm, placed: true });
  expect(seated).toMatchObject({ callId: call, started: true });
  expect(requests).toContain(`GET /dss/messages/channel/${dm}/items/${asked}`);
  expect(requests).toContain('POST /dss/channels/get_or_create_dm');
  expect(requests).toContain(`POST /dss/call/${dm}`);
  expect(requests.filter((line) => /[{}]|%7B/i.test(line))).toEqual([]);
});

test("a message passed as { channelId, messageId } is refused, and Macro isn't asked", async () => {
  const requests: string[] = [];
  fakeMacro(requests);
  const macro = new Macro({ auth: { type: 'user', apiKey: 'mak_test' } });
  const api = sdkCalls({
    macro: async () => macro,
    connectRoom: async () => {
      throw new Error('no room in this test');
    },
    publishScreen: async () => {
      throw new Error('no screen in this test');
    },
  });
  const disk = memoryDisk();
  const clock = { now: () => Temporal.Now.instant() };
  // The shape an agent's script once passed, past the type check.
  const wrong = { channelId: dm, messageId: asked } as unknown as {
    channelId: string;
    id: string;
  };
  const outcome = await placeCall(
    {
      target: owner,
      reason: 'You asked me to call.',
      message: { channel: wrong.channelId, id: wrong.id },
    },
    {
      ...macroPlaceFacts(api),
      owner,
      clock,
      rows: ledger<PlaceRow, NewPlaceRow>({
        file: 'outbound.jsonl',
        schema: PlaceRow,
        disk,
        clock,
      }),
      noCall: idList({ file: 'no-call.json', disk }),
      lock: async () => ({ release: () => {} }),
      suffix: () => 'abc',
    }
  );
  expect(outcome).toMatchObject({ ok: false, rule: 'message-id' });
  expect(outcome.ok ? '' : outcome.why).toContain('{ channelId, id }');
  expect(requests).toEqual([]);
});
