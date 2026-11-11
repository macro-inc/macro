import { expect, test } from 'bun:test';
import { Room } from '@livekit/rtc-node';
import {
  AlreadyConnectedError,
  CallEndedError,
  InOtherCallError,
  Macro,
} from '@macro-inc/sdk';
import type {
  CallConnection,
  connectRoom,
  publishScreen,
  ScreenFrame,
} from '@macro-inc/sdk/calls/node';
import { joinErrorRules } from '../arbiter.ts';
import {
  type CallApi,
  refusal,
  refusalExits,
  refusalOfExit,
  sdkCalls,
  tokenOf,
} from '../macro.ts';
import { Refusal } from '../types.ts';

/** What the fake Macro was asked to do, in order. */
type Actions = unknown[][];

/** A seat as Macro's SDK returns one: it carries the room credential. */
const seated = (id: string, actions: Actions, started = false) => ({
  url: 'wss://room',
  token: 'secret-room-token',
  identity: 'assistant',
  roomName: `room-${id}`,
  call: { id },
  started,
  leave: async () => {
    actions.push(['leave', id]);
    return { callEnded: false };
  },
});

type Record = ReturnType<typeof record>;
/** A live call as `calls.active()` lists it. Counts how often its details are read. */
const record = (
  id: string,
  kind: 'channel' | 'standalone',
  counts: { details: number; meetings: number },
  over: { readonly url?: string; readonly channel?: string | null } = {}
) => ({
  id,
  kind,
  channel: async () => {
    counts.details += 1;
    return kind === 'channel' && over.channel !== null
      ? { id: over.channel ?? 'ch' }
      : undefined;
  },
  creator: async () => ({ id: 'cy' }),
  startedAt: async () => 'now',
  meeting: async () => {
    counts.meetings += 1;
    return {
      id: 'meet',
      title: async () => 'Standup',
      webUrl: async () => over.url ?? 'https://macro.com/app/meet/join/share',
    };
  },
});

/**
 * The real SDK client with the namespaces under test replaced, so the adapter
 * is typed against the real `Macro` and nothing here can reach the network:
 * a namespace a test didn't replace would need a request, and the key is fake.
 */
const fakeMacro = (
  parts: Readonly<{
    calls?: object;
    channels?: object;
    meetings?: object;
    users?: object;
    events?: object;
  }>
): Macro =>
  Object.assign(new Macro({ auth: { type: 'user', apiKey: 'test' } }), parts);

const connected: CallConnection[] = [];
const published: unknown[][] = [];
const fakeConnect: typeof connectRoom = async (target) => {
  const connection =
    'join' in target ? await target.join() : await target.startCall();
  connected.push(connection);
  return { room: new Room(), connection };
};
const fakePublish: typeof publishScreen = async (room, frames, options) => {
  published.push([room, frames, options]);
  return { stop: async () => {}, stopped: Promise.resolve() };
};
const apiOver = (macro: Macro): CallApi =>
  sdkCalls({
    macro: async () => macro,
    connectRoom: fakeConnect,
    publishScreen: fakePublish,
  });

/** A Macro whose every way into a call is recorded. `live` is the channel's live call, if any. */
const joinable = (actions: Actions, live: string | null = null) =>
  fakeMacro({
    calls: {
      byId: (id: string) => ({
        join: async (options: unknown) => {
          actions.push(['call', id, options]);
          return seated(id, actions);
        },
      }),
      active: async () => [],
    },
    channels: {
      byId: (id: string) => ({
        startCall: async (options: unknown) => {
          actions.push(['start', id, options]);
          return seated('placed', actions, true);
        },
        activeCall: async () => {
          actions.push(['active', id]);
          return live === null
            ? undefined
            : {
                id: live,
                join: async (options: unknown) => {
                  actions.push(['call', live, options]);
                  return seated(live, actions);
                },
              };
        },
      }),
    },
    meetings: {
      lookup: async (token: string) => ({
        join: async (options: unknown) => {
          actions.push(['meeting', token, options]);
          return seated('meeting-call', actions);
        },
      }),
    },
  });

const thrown = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error
  );

test('a join by call id uses calls.byId(id).join with what the arbiter decided, and never starts a call', async () => {
  const actions: Actions = [];
  const api = apiOver(joinable(actions));
  const live = await api.join({
    kind: 'channel',
    id: 'ch',
    callId: 'live',
    onOtherCall: 'switch',
    replace: true,
  });
  expect(actions).toEqual([
    ['call', 'live', { onOtherCall: 'switch', replace: true }],
  ]);
  expect(live).toMatchObject({
    callId: 'live',
    room: 'room-live',
    started: false,
  });
  // A meeting joined by its call id goes the same way: the id is what's live.
  await api.join({ kind: 'meeting', id: 'share', callId: 'meet-call' });
  expect(actions[1]).toEqual([
    'call',
    'meet-call',
    { onOtherCall: 'fail', replace: undefined },
  ]);
  expect(actions.some(([what]) => what === 'start')).toBe(false);
});

test('only a placed call starts one: channel.startCall, which is what rings', async () => {
  const actions: Actions = [];
  const api = apiOver(joinable(actions));
  const call = await api.join({ kind: 'channel', id: 'ch', placed: true });
  expect(actions).toEqual([
    ['start', 'ch', { onOtherCall: 'fail', replace: undefined }],
  ]);
  expect(call).toMatchObject({ callId: 'placed', started: true });
});

test('a meeting with no call id is joined by its invitation token', async () => {
  const actions: Actions = [];
  const api = apiOver(joinable(actions));
  const call = await api.join({ kind: 'meeting', id: 'share' });
  expect(actions).toEqual([
    ['meeting', 'share', { onOtherCall: 'fail', replace: undefined }],
  ]);
  expect(call.callId).toBe('meeting-call');
});

test("a channel join with no call id joins the channel's live call, and is `ended` if there is none: it can't ring the channel", async () => {
  const actions: Actions = [];
  const call = await apiOver(joinable(actions, 'live')).join({
    kind: 'channel',
    id: 'ch',
  });
  expect(call.callId).toBe('live');
  expect(actions).toEqual([
    ['active', 'ch'],
    ['call', 'live', { onOtherCall: 'fail', replace: undefined }],
  ]);

  const none: Actions = [];
  const error = await thrown(
    apiOver(joinable(none)).join({ kind: 'channel', id: 'ch' })
  );
  expect(refusal(error)).toBe('ended');
  expect(none).toEqual([['active', 'ch']]);
});

test('every join asks Macro to fail rather than evict the agent, unless told to switch', async () => {
  const actions: Actions = [];
  const api = apiOver(joinable(actions, 'live'));
  await api.join({ kind: 'channel', id: 'ch' });
  await api.join({ kind: 'channel', id: 'ch', callId: 'live' });
  await api.join({ kind: 'channel', id: 'ch', placed: true });
  await api.join({ kind: 'meeting', id: 'share' });
  const options = actions
    .filter(([what]) => what !== 'active')
    .map(([, , asked]) => asked);
  expect(options).toHaveLength(4);
  for (const asked of options)
    expect(asked).toEqual({ onOtherCall: 'fail', replace: undefined });
});

test("the connection keeps its own leave, and a second leave's 404 is swallowed", async () => {
  const actions: Actions = [];
  const live = await apiOver(joinable(actions)).join({
    kind: 'channel',
    id: 'ch',
    callId: 'live',
  });
  await live.leave();
  expect(actions.at(-1)).toEqual(['leave', 'live']);

  const failing = (status: number) =>
    apiOver(
      fakeMacro({
        calls: {
          byId: (id: string) => ({
            join: async () => ({
              ...seated(id, []),
              leave: async () => {
                throw Object.assign(new Error('leave'), { status });
              },
            }),
          }),
        },
      })
    ).join({ kind: 'channel', id: 'ch', callId: 'live' });
  await (await failing(404)).leave();
  expect(await thrown((await failing(500)).leave())).toMatchObject({
    status: 500,
  });
});

test("connect hands the seat it already has to the SDK's connectRoom: no second token request", async () => {
  const actions: Actions = [];
  const live = await apiOver(joinable(actions)).join({
    kind: 'channel',
    id: 'ch',
    callId: 'live',
  });
  connected.length = 0;
  const room = await live.connect();
  expect(room).toBeInstanceOf(Room);
  expect(connected).toHaveLength(1);
  expect(connected[0]).toMatchObject({
    call: { id: 'live' },
    token: 'secret-room-token',
  });
  expect(actions.filter(([what]) => what === 'call')).toHaveLength(1);
});

test("a Connection can't leak the room token: it isn't a field, and it doesn't serialize", async () => {
  const live = await apiOver(joinable([])).join({
    kind: 'channel',
    id: 'ch',
    callId: 'live',
  });
  expect(Object.keys(live).sort()).toEqual([
    'callId',
    'connect',
    'leave',
    'room',
    'started',
  ]);
  expect(JSON.stringify(live)).not.toContain('secret-room-token');
  expect(JSON.stringify(live)).not.toContain('wss://');
});

test("the active list is shared by one tick's readers, and a call's details are read once", async () => {
  const counts = { details: 0, meetings: 0 };
  let active = 0;
  const api = apiOver(
    fakeMacro({
      calls: {
        active: async () => {
          active += 1;
          return [
            record('c', 'channel', counts),
            record('m', 'standalone', counts),
          ];
        },
      },
    })
  );
  const [calls, meetings] = await Promise.all([
    api.activeCalls(),
    api.meetings(),
  ]);
  expect(active).toBe(1);
  expect(calls).toEqual([
    { callId: 'c', channelId: 'ch', createdBy: 'cy', createdAt: 'now' },
  ]);
  expect(meetings).toEqual([
    {
      id: 'meet',
      callId: 'm',
      title: 'Standup',
      token: 'share',
      createdBy: 'cy',
    },
  ]);
  await Promise.all([api.activeCalls(), api.meetings()]);
  // A new tick asks again; what can't change about a call isn't.
  expect(active).toBe(2);
  expect(counts).toEqual({ details: 2, meetings: 1 });
});

test("a failed read of a call's details is tried again, not remembered", async () => {
  const counts = { details: 0, meetings: 0 };
  let fail = true;
  const live: Record = {
    ...record('c', 'channel', counts),
    creator: async () => {
      if (fail) throw new Error('gateway');
      return { id: 'cy' };
    },
  };
  const api = apiOver(fakeMacro({ calls: { active: async () => [live] } }));
  expect(String(await thrown(api.activeCalls()))).toContain('gateway');
  fail = false;
  expect(await api.activeCalls()).toMatchObject([{ callId: 'c' }]);
});

test('a meeting whose link has no token has none, and a channel call with no channel is an error', async () => {
  const counts = { details: 0, meetings: 0 };
  const tokenless = apiOver(
    fakeMacro({
      calls: {
        active: async () => [
          record('m', 'standalone', counts, {
            url: 'https://macro.com/app/meet/join/',
          }),
        ],
      },
    })
  );
  expect(await tokenless.meetings()).toMatchObject([
    { callId: 'm', token: null },
  ]);
  const orphan = apiOver(
    fakeMacro({
      calls: {
        active: async () => [record('c', 'channel', counts, { channel: null })],
      },
    })
  );
  expect(String(await thrown(orphan.activeCalls()))).toContain('no channel');
});

test("tokenOf is the decoded end of a meeting's link", () => {
  expect(tokenOf('https://macro.com/app/meet/join/share')).toBe('share');
  expect(tokenOf('https://macro.com/app/meet/join/a%2Fb%20c')).toBe('a/b c');
  expect(tokenOf('https://macro.com/app/meet/join/')).toBe('');
  expect(tokenOf('')).toBe('');
});

test("attendees come from the call's roster, by the call id the live list gave for that token", async () => {
  const counts = { details: 0, meetings: 0 };
  const api = apiOver(
    fakeMacro({
      calls: {
        active: async () => [record('m', 'standalone', counts)],
        byId: (id: string) => ({
          participants: async () => [{ displayName: `Ada in ${id}` }],
        }),
      },
    })
  );
  // Before the list has been read, the token is all there is.
  expect(await api.attendees('call-id')).toEqual(['Ada in call-id']);
  await api.meetings();
  expect(await api.attendees('share')).toEqual(['Ada in m']);
});

test('a channel is a DM by its type, and a name that failed to load is empty and asked for again', async () => {
  let reads = 0;
  let named = false;
  const api = apiOver(
    fakeMacro({
      channels: {
        byId: (id: string) => ({
          type: async () => {
            reads += 1;
            if (id === 'broken') throw new Error('gateway');
            return id === 'dm' ? 'direct_message' : 'private';
          },
          name: async () => {
            if (id === 'flaky' && !named) throw new Error('gateway');
            return id === 'dm' ? '' : 'eng';
          },
        }),
      },
    })
  );
  expect(await api.channel('team')).toEqual({ dm: false, name: 'eng' });
  expect(await api.channel('team')).toEqual({ dm: false, name: 'eng' });
  expect(reads).toBe(1);
  expect(await api.channel('dm')).toEqual({ dm: true, name: '' });
  expect(await api.channel('broken')).toEqual({ dm: false, name: 'eng' });
  // A name that didn't load is empty, and isn't kept: the next read asks again.
  expect(await api.channel('flaky')).toEqual({ dm: false, name: '' });
  named = true;
  expect(await api.channel('flaky')).toEqual({ dm: false, name: 'eng' });
});

test("liveCall reads a channel's live call without joining it", async () => {
  const actions: Actions = [];
  expect(await apiOver(joinable(actions, 'live')).liveCall('ch')).toBe('live');
  expect(await apiOver(joinable(actions)).liveCall('ch')).toBeNull();
  expect(actions).toEqual([
    ['active', 'ch'],
    ['active', 'ch'],
  ]);
});

/** A channel message as the SDK hands one over. */
const message = (id: string, author: string, name: string | Error) => ({
  id,
  author: async () => ({
    id: author,
    name: async () => {
      if (name instanceof Error) throw name;
      return name;
    },
  }),
  createdAt: async () => `2026-11-05T14:0${id}:00Z`,
  content: async () => `text ${id}`,
});

test("messagesSince is oldest first, at most 100, with the author's name or their id", async () => {
  const asked: unknown[][] = [];
  const channel = (count: number) =>
    apiOver(
      fakeMacro({
        channels: {
          byId: (id: string) => ({
            messagesAfter: async function* (since: string) {
              asked.push([id, since]);
              // The SDK gives newest first.
              for (let n = count; n >= 1; n--)
                yield message(
                  String(n),
                  `macro|u${n}@example.com`,
                  n === 1 ? new Error('no name') : `User ${n}`
                );
            },
          }),
        },
      })
    );
  const since = Temporal.Instant.from('2026-11-05T14:00:00Z');
  expect(await channel(2).messagesSince('ch', since)).toEqual([
    {
      id: '1',
      from: 'macro|u1@example.com',
      fromId: 'macro|u1@example.com',
      at: '2026-11-05T14:01:00Z',
      text: 'text 1',
    },
    {
      id: '2',
      from: 'User 2',
      fromId: 'macro|u2@example.com',
      at: '2026-11-05T14:02:00Z',
      text: 'text 2',
    },
  ]);
  expect(asked).toEqual([['ch', since.toString()]]);
  const many = await channel(150).messagesSince('ch', since);
  expect(many).toHaveLength(100);
  // The newest hundred, still oldest first.
  expect(many[0]?.id).toBe('51');
  expect(many.at(-1)?.id).toBe('150');
});

test("who wrote a message is Macro's record of it, with whether it was a DM", async () => {
  const api = apiOver(
    fakeMacro({
      channels: {
        byId: (channelId: string) => ({
          type: async () => (channelId === 'dm' ? 'direct_message' : 'public'),
          name: async () => 'eng',
          message: (id: string) => message(id, 'macro|cy@example.com', 'Cy'),
        }),
      },
    })
  );
  expect(await api.message('dm', '7')).toEqual({
    author: 'macro|cy@example.com',
    name: 'Cy',
    text: 'text 7',
    at: Temporal.Instant.from('2026-11-05T14:07:00Z'),
    dm: true,
  });
  expect((await api.message('team', '7')).dm).toBe(false);
});

test('me, members, and the DM channel', async () => {
  const _actions: Actions = [];
  const api = apiOver(
    fakeMacro({
      users: {
        me: async () => ({ id: 'macro|agent@example.com' }),
        byId: (id: string) => ({ id }),
      },
      channels: {
        byId: () => ({
          participants: async () => [
            { user_id: 'macro|a@example.com' },
            { user_id: 'macro|b@example.com' },
          ],
        }),
        dm: async (user: { readonly id: string }) => ({
          id: `dm-with-${user.id}`,
        }),
      },
    })
  );
  expect(await api.me()).toBe('macro|agent@example.com');
  expect(await api.members('ch')).toEqual([
    'macro|a@example.com',
    'macro|b@example.com',
  ]);
  expect(await api.dmChannel('macro|cy@example.com')).toBe(
    'dm-with-macro|cy@example.com'
  );
});

test("publishScreen is the SDK's, with the room, the frames and the options as given", async () => {
  const api = apiOver(fakeMacro({}));
  const room = new Room();
  const frames = (async function* (): AsyncGenerator<ScreenFrame> {})();
  published.length = 0;
  await api.publishScreen(room, frames, { fps: 10 });
  expect(published).toEqual([[room, frames, { fps: 10 }]]);
});

test('watch listens for the five call events on a stream of its own, and stopping takes it all down', async () => {
  const handlers = new Map<string, () => void>();
  const filters: unknown[] = [];
  const states: boolean[] = [];
  let stopped = 0;
  let changes = 0;
  const api = apiOver(
    fakeMacro({
      events: {
        on: (name: string, handler: () => void) => {
          handlers.set(name, handler);
          return () => handlers.delete(name);
        },
        listen: async (options: unknown) => {
          filters.push(options);
          return () => {
            stopped += 1;
          };
        },
      },
    })
  );
  const stop = await api.watch({
    changed: () => {
      changes += 1;
    },
    up: (up) => states.push(up),
  });
  const events = [
    'call.started',
    'call.ended',
    'call.ringing',
    'call.invited',
    'call.participant_left',
  ];
  expect([...handlers.keys()]).toEqual(events);
  expect(filters).toEqual([{ filters: [{ events }] }]);
  expect(states).toEqual([true]);
  handlers.get('call.started')?.();
  handlers.get('call.ended')?.();
  expect(changes).toBe(2);
  stop();
  expect(stopped).toBe(1);
  expect(handlers.size).toBe(0);
  expect(states).toEqual([true, false]);
});

// Refusals: why Macro wouldn't seat the agent, and how a join's exit says so.

test("refusal reads the SDK's own errors by name, and the rest by status", () => {
  expect(refusal(new InOtherCallError({}))).toBe('in_other_call');
  expect(refusal(new AlreadyConnectedError({}))).toBe('already_connected');
  expect(refusal(new CallEndedError({}))).toBe('ended');
  // By name, not instanceof: a second copy of the SDK has other classes.
  expect(
    refusal(
      Object.assign(new Error('other call'), {
        name: 'InOtherCallError',
        status: 409,
      })
    )
  ).toBe('in_other_call');
  expect(refusal({ name: 'AlreadyConnectedError' })).toBe('already_connected');
  expect(refusal({ status: 410 })).toBe('ended');
  expect(refusal({ status: 429 })).toBe('rate_limited');
  expect(refusal({ status: 403 })).toBe('refused');
  // The call routes answer 404 for a user without programmatic calls enabled.
  expect(refusal({ status: 404 })).toBe('flag_off');
});

test("anything else isn't a refusal, so it is worth another try", () => {
  expect(refusal(new Error('ConnectionRefused'))).toBeNull();
  expect(refusal(new Error('timed out after 2000 ms'))).toBeNull();
  expect(refusal({ status: 500 })).toBeNull();
  expect(refusal({ status: 409 })).toBeNull();
  expect(refusal(null)).toBeNull();
  expect(refusal(undefined)).toBeNull();
  expect(refusal('InOtherCallError')).toBeNull();
});

test("a refused join exits with its own code: never a plain failure's, and an ended call is a clean exit", () => {
  expect(refusalExits).toEqual({
    in_other_call: 76,
    already_connected: 77,
    ended: 0,
    rate_limited: 78,
    refused: 79,
    flag_off: 80,
  });
  const codes = Refusal.options
    .filter((name) => name !== 'ended')
    .map((name) => refusalExits[name]);
  expect(new Set(codes).size).toBe(codes.length);
  // 1 is any failure, and 75 is kept clear of the refusals.
  for (const code of codes) expect([0, 1, 75]).not.toContain(code);
});

test('the watcher reads the refusal back from the exit code, and a clean exit is none', () => {
  for (const name of Refusal.options)
    expect(refusalOfExit(refusalExits[name])).toBe(
      name === 'ended' ? undefined : name
    );
  expect(refusalOfExit(0)).toBeUndefined();
  expect(refusalOfExit(1)).toBeUndefined();
  expect(refusalOfExit(75)).toBeUndefined();
  expect(refusalOfExit(143)).toBeUndefined();
});

test('every refusal has a row saying what the watcher does next', () => {
  expect(joinErrorRules.map((rule) => rule.refusal)).toEqual(Refusal.options);
});

// One RTC copy: a second native runtime, even at the same version, makes Room
// classes the session can't use. The SDK's helper, Agents and the agent must all
// resolve the same installation.

test("the SDK's room helper, LiveKit Agents and the agent resolve one @livekit/rtc-node", () => {
  const rtc = '@livekit/rtc-node';
  const from = (specifier: string): string =>
    Bun.resolveSync(rtc, Bun.resolveSync(specifier, import.meta.dir));
  const ours = Bun.resolveSync(rtc, import.meta.dir);
  expect(from('@macro-inc/sdk/calls/node')).toBe(ours);
  expect(from('@livekit/agents')).toBe(ours);
});

test("postChat goes where the sidebar is: a channel call's thread, else the call's own chat", async () => {
  const posts: unknown[][] = [];
  const macro = (channelCall: boolean) =>
    fakeMacro({
      calls: {
        byId: (id: string) => ({
          discussion: async () =>
            channelCall
              ? {
                  reply: async (text: string) =>
                    void posts.push(['thread', id, text]),
                }
              : {},
          message: (messageId: string) => ({
            reply: async (text: string) =>
              void posts.push(['call', id, messageId, text]),
          }),
        }),
      },
    });
  await apiOver(macro(true)).postChat('c1', 'link');
  await apiOver(macro(false)).postChat('m1', 'id');
  expect(posts).toEqual([
    ['thread', 'c1', 'link'],
    ['call', 'm1', 'm1', 'id'],
  ]);
});
