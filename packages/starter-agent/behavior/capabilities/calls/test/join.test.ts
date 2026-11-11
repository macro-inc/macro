import { expect, test } from 'bun:test';
import { Room } from '@livekit/rtc-node';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { state as makeState } from '../../../context/state.ts';
import { ringMs } from '../arbiter.ts';
import type { BrainNeeds } from '../brain.ts';
import { callsPaths } from '../config.ts';
import { eventLog } from '../events.ts';
import {
  type Appraisal,
  aloneMs,
  greeting,
  type JoinInput,
  type JoinPorts,
  joinCall,
  type LeaveSignal,
  leaveReason,
  nobodyMs,
  type SessionNeeds,
  seat,
  uninvitedGreeting,
} from '../join.ts';
import {
  type Connection,
  type JoinRequest,
  refusal,
  refusalExits,
} from '../macro.ts';
import { stubBrain } from '../replay.ts';
import type { RoomHandlers } from '../room.ts';
import { CallEvent, type NewPlaceRow, type Placed } from '../types.ts';

const join = (...parts: readonly string[]) => parts.join('/');
const paths = callsPaths({
  state: makeState({ root: '/assistant', join }),
  join,
});
const never = new Promise<never>(() => undefined);
const at = Temporal.Instant.from('2026-11-09T12:00:00Z');
/** Short waits pass at once; the long ones (a leave that hangs, a line that never plays) never do. */
const clock: Clock = {
  now: () => at,
  sleep: (ms) => (ms >= 3000 ? never : Promise.resolve()),
};
const connection = (overrides: Partial<Connection> = {}): Connection => ({
  callId: 'call-1',
  room: 'room-1',
  started: false,
  connect: async () => new Room(),
  leave: async () => undefined,
  ...overrides,
});
const inOtherCall = Object.assign(new Error('other call'), {
  name: 'InOtherCallError',
  status: 409,
});

test('the token request survives a hung attempt and a refused connection, and logs every attempt', async () => {
  let attempts = 0;
  const seated = connection();
  const events: (readonly [string, unknown])[] = [];
  const got = await seat(
    {
      join: async () => {
        attempts++;
        // A connect that hangs, then one that is refused.
        if (attempts === 1) return never;
        if (attempts === 2) throw new Error('ConnectionRefused');
        return seated;
      },
    },
    { kind: 'channel', id: 'ch' },
    (type, data) => events.push([type, data?.error !== undefined]),
    clock,
    { attempts: 4, timeoutMs: 20, backoffMs: [1, 1, 1] }
  );
  expect(got).toBe(seated);
  expect(events).toEqual([
    ['join.token', true],
    ['join.token', true],
    ['join.token', false],
  ]);
});

test('the token request gives up with the last error after its attempts, so the join fails fast', async () => {
  const failure = await seat(
    { join: async () => Promise.reject(new Error('ConnectionRefused')) },
    { kind: 'channel', id: 'ch' },
    () => undefined,
    clock,
    { attempts: 3, timeoutMs: 50, backoffMs: [1, 1] }
  ).catch((error: unknown) => error);
  expect(String(failure)).toContain('ConnectionRefused');
});

test("Macro's refusal is classified and is not retried within the same join", async () => {
  let attempts = 0;
  const failure = await seat(
    {
      join: async () => {
        attempts++;
        throw inOtherCall;
      },
    },
    { kind: 'channel', id: 'ch', callId: 'live' },
    () => undefined,
    clock,
    { attempts: 4, timeoutMs: 50, backoffMs: [1, 1, 1] }
  ).catch((error: unknown) => error);
  expect(failure).toBe(inOtherCall);
  expect(attempts).toBe(1);
  expect(refusal(inOtherCall)).toBe('in_other_call');
  expect(refusalExits.in_other_call).not.toBe(1);
  expect(refusalExits.ended).toBe(0);
});

test('the agent leaves 30 s after the last human, 60 s if nobody came, and a call it placed rings out', () => {
  const alone = (humanCame: boolean, placing: boolean, aloneForMs: number) =>
    leaveReason({ humanCame, placing, aloneForMs });
  expect(alone(true, false, aloneMs)).toBeUndefined();
  expect(alone(true, false, aloneMs + 1)).toBe('everyone left');
  expect(alone(true, true, aloneMs + 1)).toBe('everyone left');
  expect(alone(false, false, aloneMs + 1)).toBeUndefined();
  expect(alone(false, false, nobodyMs + 1)).toBe('nobody came');
  expect(alone(false, true, ringMs)).toBeUndefined();
  expect(alone(false, true, ringMs + 1)).toBe('no answer');
});

/** One join against fakes of everything outside it. */
const harness = (
  options: {
    readonly join?: (request: JoinRequest) => Promise<Connection>;
    readonly pending?: Placed;
    readonly files?: Readonly<Record<string, string>>;
    readonly playout?: Promise<void>;
  } = {}
) => {
  const events: CallEvent[] = [];
  const files = new Map(Object.entries(options.files ?? {}));
  const printed: string[] = [];
  const complaints: string[] = [];
  const signals = new Map<LeaveSignal, () => void>();
  const requests: JoinRequest[] = [];
  const rows: NewPlaceRow[] = [];
  const told: Placed[] = [];
  const hungUp: string[] = [];
  const said: { readonly line: string; readonly options: unknown }[] = [];
  const recorded: string[] = [];
  /** What reached the session's listeners: "hear:<who>:<name>" and "gone:<who>". */
  const heard: string[] = [];
  const appraised: Appraisal[] = [];
  const cards: unknown[] = [];
  const humans: string[] = [];
  const counts = { left: 0, closed: 0, interrupted: 0, disposed: 0 };
  const captured: {
    handlers?: RoomHandlers;
    brain?: BrainNeeds;
    session?: SessionNeeds;
  } = {};
  const seated = connection({
    leave: async () => {
      counts.left++;
    },
  });
  const ports: JoinPorts = {
    name: 'Agent',
    api: {
      join: (request) => {
        requests.push(request);
        return options.join?.(request) ?? Promise.resolve(seated);
      },
      publishScreen: () => never,
    },
    secrets: async () => undefined,
    outbound: {
      pending: async () => options.pending,
      add: async (row) => {
        rows.push(row);
      },
    },
    tellNoAnswer: async (placed) => {
      told.push(placed);
    },
    openingLine: (reason) => `Hi, it's Agent. ${reason}`,
    hungUp: {
      add: async (id) => {
        hungUp.push(id);
      },
    },
    people: {
      cards: async (ids, purpose, cardOptions) => {
        cards.push([ids, purpose, cardOptions]);
        return '';
      },
    },
    appraise: (call) => appraised.push(call),
    clock,
    monotonic: () => 0,
    paths,
    disk: {
      read: async (path) => files.get(path),
      write: async (path, text) => {
        files.set(path, text);
      },
      remove: async (path) => {
        files.delete(path);
      },
    },
    proc: {
      pid: 4242,
      print: (line) => printed.push(line),
      complain: (line) => complaints.push(line),
      onSignal: (signal, handle) => signals.set(signal, handle),
    },
    log: ({ file, elapsed }) =>
      eventLog({
        elapsed,
        echo: (line) =>
          events.push({ ...CallEvent.parse(JSON.parse(line)), file }),
      }),
    recorder: ({ who }) => ({
      write: () => recorded.push(who),
      close: () => undefined,
      written: () => 0,
    }),
    brain: (needs) => {
      captured.brain = needs;
      return stubBrain(() => undefined);
    },
    livekit: async () => ({
      room: (_room, _emit, handlers) => {
        captured.handlers = handlers;
        return {
          present: () => undefined,
          humans: () => humans,
          lastSpeaker: () => ['macro|ann@example.com', 'Ann'],
          leave: async () => undefined,
        };
      },
      session: async (needs) => {
        captured.session = needs;
        return {
          start: async () => undefined,
          say: (line, sayOptions) => {
            said.push({ line, options: sayOptions });
            return options.playout ?? Promise.resolve();
          },
          interrupt: () => {
            counts.interrupted++;
          },
          busy: () => false,
          hear: (who, name) => {
            heard.push(`hear:${who}:${name}`);
          },
          gone: (who) => {
            heard.push(`gone:${who}`);
          },
          close: async () => {
            counts.closed++;
          },
        };
      },
      dispose: async () => {
        counts.disposed++;
      },
    }),
  };
  /** Lets the join run as far as it can. */
  const settle = () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  return {
    ports,
    events,
    types: () => events.map(({ type }) => type),
    files,
    printed,
    complaints,
    signals,
    requests,
    rows,
    told,
    hungUp,
    said,
    recorded,
    heard,
    appraised,
    cards,
    humans,
    counts,
    captured,
    settle,
    run: (input: Partial<JoinInput> = {}) =>
      joinCall(ports, { kind: 'channel', id: 'ch-1', ...input }),
  };
};

test('a join: events from t=0, the pid, the call id on stdout, the greeting, and out on SIGTERM with the seat given back', async () => {
  const h = harness();
  const over = h.run({ callId: 'call-1' });
  await h.settle();
  expect(h.requests).toEqual([
    {
      kind: 'channel',
      id: 'ch-1',
      callId: 'call-1',
      placed: undefined,
      // Never an eviction by accident.
      onOtherCall: 'fail',
      replace: undefined,
    },
  ]);
  expect(h.files.get(paths.pid('call-1'))).toBe('4242');
  expect(h.printed).toEqual([
    JSON.stringify({ callId: 'call-1', dir: paths.call('call-1') }),
  ]);
  expect(h.said).toEqual([{ line: greeting('Agent'), options: undefined }]);
  expect(h.types().slice(0, 4)).toEqual([
    'join.start',
    'join.secrets',
    'join.token',
    'call.start',
  ]);
  expect(h.events.every(({ file }) => file === paths.events('call-1'))).toBe(
    true
  );
  expect(h.captured.brain?.channel).toBe('ch-1');

  h.signals.get('SIGTERM')?.();
  expect(await over).toEqual({
    callId: 'call-1',
    dir: paths.call('call-1'),
    code: 0,
    why: 'SIGTERM',
  });
  expect(h.counts).toEqual({ left: 1, closed: 1, interrupted: 0, disposed: 1 });
  expect(h.types().slice(-2)).toEqual(['call.leave', 'call.end']);
});

test("Macro's refusal exits with its own code, and an ended call is a clean exit", async () => {
  const refused = harness({ join: () => Promise.reject(inOtherCall) });
  expect(await refused.run({ callId: 'call-1' })).toMatchObject({
    code: refusalExits.in_other_call,
  });
  expect(refused.requests.length).toBe(1);
  expect(refused.types()).toContain('join.refusal');
  expect(refused.types().at(-1)).toBe('join.failed');
  expect(refused.complaints.length).toBe(1);

  const gone = harness({
    join: () =>
      Promise.reject(Object.assign(new Error('gone'), { status: 410 })),
  });
  expect(await gone.run({ callId: 'call-1' })).toMatchObject({ code: 0 });
  expect(gone.types().at(-1)).toBe('join.gone');
  expect(gone.complaints).toEqual([]);
});

test("a room that won't connect gives the seat back and fails at the room stage", async () => {
  const h = harness({
    join: async () =>
      connection({
        connect: () => Promise.reject(new Error('no route')),
        leave: async () => {
          h.counts.left++;
        },
      }),
  });
  expect(await h.run({ callId: 'call-1' })).toMatchObject({
    code: 1,
    callId: 'call-1',
  });
  expect(h.counts.left).toBe(1);
  expect(h.events.at(-1)).toMatchObject({ type: 'join.failed', stage: 'room' });
  expect(h.appraised).toEqual([]);
});

const placed: Placed = {
  id: 'p1',
  channelId: 'ch-1',
  target: 'macro|cy@example.com',
  asker: 'macro|owner@example.com',
  reason: 'Ada asked me to check on the launch.',
  rule: 'owner-order',
  at,
};

test('a call it is placing must be pending in the ledger', async () => {
  const h = harness();
  expect(await h.run({ callId: 'place-p1' })).toMatchObject({ code: 1 });
  // No token request: that is what would have rung them.
  expect(h.requests).toEqual([]);
  expect(h.events.at(-1)).toMatchObject({
    type: 'join.failed',
    stage: 'place',
  });
});

test('a placed call: the token request rings, the ledger follows it, and nobody answering is told by DM', async () => {
  const h = harness({ pending: placed });
  const over = h.run({ callId: 'place-p1' });
  await h.settle();
  expect(h.requests[0]).toMatchObject({ placed: true, callId: undefined });
  // The room's id is known now: its events and pid go in its own directory.
  expect(h.files.get(paths.pid('call-1'))).toBe('4242');
  expect(h.events.at(-1)?.file).toBe(paths.events('call-1'));
  // Nobody to greet until they pick up.
  expect(h.said).toEqual([]);
  expect(h.captured.brain?.placed).toEqual({
    target: placed.target,
    asker: placed.asker,
    opening: "Hi, it's Agent. Ada asked me to check on the launch.",
  });
  h.signals.get('SIGTERM')?.();
  await over;
  expect(h.rows).toEqual([
    { id: 'p1', event: 'joined', callId: 'call-1' },
    { id: 'p1', event: 'no_answer', callId: 'call-1', why: 'SIGTERM' },
  ]);
  expect(h.told).toEqual([placed]);
});

test('a placed call that is answered is marked answered, then ended', async () => {
  const h = harness({ pending: placed });
  const over = h.run({ callId: 'place-p1' });
  await h.settle();
  h.humans.push(placed.target);
  h.captured.handlers?.joined(placed.target, 'Cy');
  h.captured.handlers?.disconnected('5');
  expect(await over).toMatchObject({ code: 0, why: 'disconnected: 5' });
  expect(h.rows.map(({ event }) => event)).toEqual([
    'joined',
    'answered',
    'ended',
  ]);
  expect(h.told).toEqual([]);
  expect(h.types()).toContain('call.answered');
});

test("every human's microphone reaches the session's listeners, by name, uninvited too; a leaver's listener goes", async () => {
  const h = harness();
  const over = h.run({ callId: 'call-1', uninvited: 'the launch came up' });
  await h.settle();
  h.captured.handlers?.joined('macro|ann@example.com', 'Ann');
  h.captured.handlers?.audio('macro|ann@example.com', new Int16Array(320));
  h.captured.handlers?.audio('macro|bo@example.com', new Int16Array(320));
  h.captured.handlers?.left('macro|bo@example.com');
  expect(h.heard).toEqual([
    'hear:macro|ann@example.com:Ann',
    'hear:macro|bo@example.com:macro|bo@example.com',
    'gone:macro|bo@example.com',
  ]);
  expect(h.recorded).toEqual([]);
  h.signals.get('SIGINT')?.();
  await over;
});

test('uninvited: it says who it is, takes only its name, keeps no voice, and the log drops what it overhears', async () => {
  const h = harness();
  const over = h.run({ callId: 'call-1', uninvited: 'the launch came up' });
  await h.settle();
  expect(h.said).toEqual([
    { line: uninvitedGreeting('Agent'), options: undefined },
  ]);
  expect(uninvitedGreeting('Agent')).toContain("It's Agent.");
  expect(h.captured.brain?.note).toContain('the launch came up');
  const session = h.captured.session;
  expect(
    (await session?.addressing.forAgent('a', 'Ann', 'so the plan is', 1, 0))
      ?.forAgent
  ).toBe(false);
  h.captured.handlers?.audio('macro|ann@example.com', new Int16Array(320));
  expect(h.recorded).toEqual([]);
  session?.emit('turn.heard', { who: 'a', text: 'private', forAgent: false });
  session?.emit('stt.final', { text: 'private' });
  session?.emit('turn.heard', { who: 'a', text: 'Agent, hi', forAgent: true });
  h.signals.get('SIGINT')?.();
  await over;
  expect(JSON.stringify(h.events)).not.toContain('private');
  expect(JSON.stringify(h.appraised)).not.toContain('private');
  expect(h.appraised[0]?.events.map(({ text }) => text)).toEqual([
    undefined,
    'Agent, hi',
  ]);
});

test("invited: every voice is recorded, and the people area gets what was said once it's out", async () => {
  const h = harness();
  const over = h.run({ callId: 'call-1' });
  await h.settle();
  h.captured.handlers?.audio('macro|ann@example.com', new Int16Array(320));
  h.captured.handlers?.audio('agent', new Int16Array(320));
  expect(h.recorded).toEqual(['macro|ann@example.com', 'agent']);
  const session = h.captured.session;
  await session?.card('macro|ann@example.com', true);
  expect(h.cards).toEqual([
    [['macro|ann@example.com'], 'call', { alone: true }],
  ]);
  session?.emit('turn.heard', {
    who: 'a',
    text: 'hello Agent',
    forAgent: true,
  });
  session?.emit('stt.final', { text: 'hello Agent' });
  session?.emit('brain.text', { turn: 1, text: 'Hey.' });
  h.signals.get('SIGTERM')?.();
  await over;
  expect(h.appraised).toEqual([
    {
      callId: 'call-1',
      channelId: 'ch-1',
      events: [
        {
          t: 0,
          type: 'turn.heard',
          who: 'a',
          text: 'hello Agent',
          forAgent: true,
        },
        { t: 0, type: 'brain.text', turn: 1, text: 'Hey.' },
      ],
    },
  ]);
});

test('SIGUSR2: it says why to the people there, uninterruptibly, removes the line once heard, and goes', async () => {
  const line = "Sorry, I'm needed on another call. I've got to go.";
  const h = harness({ files: { [paths.leave(4242)]: line } });
  const over = h.run({ callId: 'call-1' });
  await h.settle();
  h.humans.push('macro|ann@example.com');
  h.signals.get('SIGUSR2')?.();
  expect(await over).toMatchObject({ code: 0, why: `moving: ${line}` });
  expect(h.counts.interrupted).toBe(1);
  expect(h.said.at(-1)).toEqual({
    line,
    options: { allowInterruptions: false, addToChatCtx: false },
  });
  expect(h.files.has(paths.leave(4242))).toBe(false);
});

test('SIGUSR2 with nobody in the room: nothing said, and the line is gone', async () => {
  const h = harness({ files: { [paths.leave(4242)]: 'Got to go.' } });
  const over = h.run({ callId: 'call-1' });
  await h.settle();
  h.signals.get('SIGUSR2')?.();
  await over;
  expect(h.said.map(({ line }) => line)).toEqual([greeting('Agent')]);
  expect(h.files.has(paths.leave(4242))).toBe(false);
});

test('hang_up: the call is marked hung up, so it is never brought back, and it leaves', async () => {
  const h = harness();
  const over = h.run({ callId: 'call-1' });
  await h.settle();
  h.captured.brain?.onHangUp();
  expect(await over).toMatchObject({ code: 0, why: 'hang_up tool' });
  expect(h.hungUp).toEqual(['call-1']);
});

test('a join by hand has no call id until the room: its events start there', async () => {
  const h = harness();
  const over = h.run({ kind: 'meeting', id: 'token' });
  await h.settle();
  expect(h.events[0]).toMatchObject({ type: 'join.start', file: undefined });
  expect(h.events.at(-1)?.file).toBe(paths.events('call-1'));
  expect(h.captured.brain?.channel).toBeUndefined();
  h.signals.get('SIGTERM')?.();
  await over;
  expect(h.appraised[0]?.channelId).toBeUndefined();
});
