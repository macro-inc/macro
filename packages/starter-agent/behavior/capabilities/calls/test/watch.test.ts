import { expect, test } from 'bun:test';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import {
  type InCall,
  joinDue,
  leaveLine,
  pending,
  type Tries,
  type World,
} from '../arbiter.ts';
import { after, callsPaths, placePrefix } from '../config.ts';
import { running } from '../context/processes.ts';
import type { JoinInput } from '../join.ts';
import type { CallApi } from '../macro.ts';
import type { AskRow, NewAskRow, NewPlaceRow, Placed } from '../types.ts';
import {
  followCalls,
  identify,
  joinInput,
  type LeaveSignal,
  leaveKillMs,
  leavePollMs,
  leaveSignal,
  leaveTermMs,
  liveJoins,
  nextPollMs,
  parseJoin,
  pollMs,
  streamRefreshMs,
  tick,
  type WatchPorts,
  watchState,
  world,
  worlds,
} from '../watch.ts';

const assistant = 'macro|agent@example.com';
const owner = 'macro|owner@example.com';
const cy = 'macro|cy@example.com';
const start = Temporal.Instant.from('2026-11-09T15:00:00Z');
const at = (ms: number) => after(start, ms);

const base = (over: Partial<World> = {}): World => ({
  me: assistant,
  owner,
  calls: [],
  meetings: [],
  allowed: new Set(),
  hungUp: new Set(),
  judged: new Map(),
  ...over,
});
const dm = (callId: string, createdBy: string) => ({
  callId,
  channelId: `ch-${callId}`,
  createdBy,
  ringing: false,
  dm: true,
  name: '',
});

test('a manual join without a call id is matched to its call by channel or token', () => {
  const w = base({
    calls: [dm('a', cy)],
    meetings: [
      { id: 'm', callId: 'meet', title: 'x', token: 'tok', createdBy: cy },
    ],
  });
  const join = (args: InCall['args'], callId: string | null = null) =>
    identify({ pid: 1, callId, args }, w).callId;
  expect(join(['channel', 'ch-a'])).toBe('a');
  expect(join(['meeting', 'tok'])).toBe('meet');
  expect(join(['channel', 'nope'])).toBeNull();
  expect(join(['channel', 'ch-a'], 'kept')).toBe('kept');
});

test('a team call is never read as ringing, so it reaches the judgment', async () => {
  const w = await world({
    api: {
      activeCalls: async () => [
        { callId: 'team', channelId: 'ch', createdBy: cy },
      ],
      meetings: async () => [],
      channel: async () => ({ dm: false, name: 'team' }),
    },
    me: assistant,
    owner,
    allowed: async () => new Set(),
    hungUp: async () => new Set(),
  });
  expect(w.calls[0]?.ringing).toBe(false);
  expect(pending(w).map(({ callId }) => callId)).toEqual(['team']);
});

test("leaving: say why and go, then SIGTERM, then SIGKILL, each once: it can't get stuck", () => {
  expect(leaveSignal(at(1000), undefined)).toBe('SIGUSR2');
  expect(leaveSignal(at(1000 + leaveTermMs - 1), at(1000), 1)).toBeNull();
  expect(leaveSignal(at(1000 + leaveTermMs), at(1000), 1)).toBe('SIGTERM');
  expect(leaveSignal(at(1000 + leaveTermMs + 1), at(1000), 2)).toBeNull();
  expect(leaveSignal(at(1000 + leaveKillMs), at(1000), 2)).toBe('SIGKILL');
  expect(leaveSignal(at(1000 + leaveKillMs + 1), at(1000), 3)).toBeNull();
});

const cli = '/assistant/cli.ts';
const argv = (root: string, input: unknown) => [
  '/nix/bun',
  `${root}/cli.ts`,
  'joinCall',
  JSON.stringify(input),
];

test('parseJoin reads a join from its arguments, and a shell that merely mentions one is not a join', () => {
  const parse = (args: readonly string[]) => parseJoin(5, args, cli);
  expect(
    parse(argv('/assistant', { kind: 'channel', id: 'ch', callId: 'id' }))
  ).toEqual({ pid: 5, callId: 'id', args: ['channel', 'ch'] });
  expect(parse(argv('/assistant', { kind: 'meeting', id: 'tok' }))).toEqual({
    pid: 5,
    callId: null,
    args: ['meeting', 'tok'],
  });
  expect(
    parse(['bash', '-c', `${cli} pgrep -af 'joinCall {"kind":"channel"}'`])
  ).toBeNull();
  expect(parse(['/nix/bun', cli, 'run'])).toBeNull();
  expect(parse(['/nix/bun', cli, 'joinCall'])).toBeNull();
  expect(parse(['/nix/bun', cli, 'joinCall', '{not json'])).toBeNull();
  expect(parse(argv('/assistant', { kind: 'phone', id: 'x' }))).toBeNull();
  expect(parse([])).toBeNull();
});

test('another identity on this machine is not the agent being busy, nor is a test join from a worktree', () => {
  const input = { kind: 'channel', id: 'ch', callId: 'id' };
  expect(parseJoin(5, argv('/assistant', input), cli)).not.toBeNull();
  expect(parseJoin(5, argv('/home/owner/other-agent', input), cli)).toBeNull();
  expect(
    parseJoin(5, argv('/assistant/.worktrees/calls', input), cli)
  ).toBeNull();
});

test("stale pid files mean nothing: only a live process with a join's arguments counts", async () => {
  // What the old call's pid became, a real join, a non-pid entry, and one gone mid-scan.
  const files = new Map([
    ['/proc/11/cmdline', '/usr/bin/vim\0notes.md\0'],
    [
      '/proc/12/cmdline',
      `${argv('/assistant', { kind: 'channel', id: 'ch', callId: 'real' }).join('\0')}\0`,
    ],
  ]);
  const processes = running({
    disk: {
      list: async () => ['11', '12', '13', 'self'],
      read: async (path) => files.get(path),
    },
    join: (...parts) => parts.join('/'),
  });
  expect(await liveJoins(processes, cli)).toEqual([
    { pid: 12, callId: 'real', args: ['channel', 'ch'] },
  ]);
});

test('after a failed join the watcher retries the still-live call within about a second', () => {
  const failed: Tries = { lastTry: at(0), lastExit: at(46_000), failures: 1 };
  expect(joinDue(at(46_500), failed)).toBe(false);
  expect(joinDue(at(47_000), failed)).toBe(true);
  // Sleeps until it's due, not the 3 s poll.
  expect(nextPollMs(at(46_000), [failed])).toBe(1000);
  // Repeated failures back off, capped.
  expect(joinDue(at(46_000 + 3_999), { ...failed, failures: 3 })).toBe(false);
  expect(joinDue(at(46_000 + 4_000), { ...failed, failures: 3 })).toBe(true);
});

test('after a clean exit the watcher waits 15 s before rejoining a call that is still live', () => {
  const left: Tries = { lastTry: at(0), lastExit: at(9_000), failures: 0 };
  expect(joinDue(at(10_000), left)).toBe(false);
  expect(joinDue(at(15_000), left)).toBe(true);
  expect(joinDue(at(0), undefined)).toBe(true);
  expect(nextPollMs(at(0), [{ lastTry: at(0), failures: 0 }])).toBe(pollMs);
});

test('a rate-limited join waits out its five minutes, and a refused one is never slept on', () => {
  const limited: Tries = {
    lastExit: at(0),
    failures: 1,
    refusal: 'rate_limited',
    delayUntil: at(300_000),
  };
  expect(nextPollMs(at(0), [limited])).toBe(pollMs);
  expect(nextPollMs(at(299_000), [limited])).toBe(1000);
  expect(
    nextPollMs(at(0), [{ lastExit: at(0), failures: 1, refusal: 'refused' }])
  ).toBe(pollMs);
});

test('call events wake the watcher; the stream is reopened every minute, and after a failure with a growing wait', async () => {
  const sleeps: number[] = [];
  let opens = 0;
  let wakes = 0;
  const watch: CallApi['watch'] = async ({ changed }) => {
    opens += 1;
    if (opens > 1) throw new Error('stream down');
    changed();
    return () => undefined;
  };
  await followCalls({
    watch,
    wake: () => {
      wakes += 1;
    },
    clock: { sleep: async (ms) => void sleeps.push(ms) },
    failed: () => undefined,
    stopped: () => opens >= 4,
  });
  expect(wakes).toBeGreaterThanOrEqual(1);
  expect(sleeps).toEqual([streamRefreshMs, 1000, 1000, 2000]);
});

// --- The readings. ---

test('a read that fails is logged and tried again at the next poll', async () => {
  const logged: object[] = [];
  const waits: number[] = [];
  let reads = 0;
  const next = { ms: 0 };
  const readings = worlds({
    read: async () => {
      reads += 1;
      if (reads === 1) throw new Error('macro down');
      return base();
    },
    pulse: { wait: async (ms) => void waits.push(ms) },
    next,
    log: (entry) => void logged.push(entry),
  });
  expect((await readings.next()).done).toBe(false);
  expect(reads).toBe(2);
  expect(waits).toEqual([pollMs]);
  expect(next.ms).toBe(pollMs);
  expect(logged).toEqual([{ read_error: 'Error: macro down' }]);
});

// --- A tick, against fakes. ---

const fakes = (
  over: {
    readonly joins?: readonly InCall[];
    readonly placed?: readonly Placed[];
    readonly told?: readonly string[];
  } = {}
) => {
  let now = at(0);
  const clock: Clock = {
    now: () => now,
    sleep: async () => undefined,
  };
  const files = new Map<string, string>(
    (over.told ?? []).map((id) => [paths.told(id), 'told'])
  );
  const started: JoinInput[] = [];
  const signals: [number, LeaveSignal][] = [];
  const posts: [unknown, string][] = [];
  const placeRows: NewPlaceRow[] = [];
  const askRows: NewAskRow[] = [];
  const exits: ((code: number) => void)[] = [];
  const logged: object[] = [];
  const ports: WatchPorts = {
    clock,
    paths,
    disk: {
      exists: async (path) => files.has(path),
      read: async (path) => files.get(path),
      write: async (path, text) => void files.set(path, text),
      append: async (path, text) =>
        void files.set(path, `${files.get(path) ?? ''}${text}`),
      remove: async (path) => void files.delete(path),
    },
    joins: async () => over.joins ?? [],
    start: async (input) => {
      started.push(input);
      return {
        pid: 500 + started.length,
        exited: new Promise((resolve) => exits.push(resolve)),
      };
    },
    signal: (pid, signal) => void signals.push([pid, signal]),
    post: async (to, text) => void posts.push([to, text]),
    reply: async (channel, root, text) =>
      void posts.push([{ channel, root }, text]),
    judgments: { tick: () => undefined, verdicts: () => new Map() },
    placed: {
      pending: async () => over.placed ?? [],
      add: async (row) => void placeRows.push(row),
      expiredLine: (target) => `Couldn't get to ${target}`,
    },
    asks: {
      read: async () => ({
        open: [],
        weighed: new Map(),
        moves: [],
        where: new Map(),
      }),
      add: async (row) => void askRows.push(row),
    },
    weigh: async () => ({ go: false, reason: 'no', need: '', by: 'rule' }),
    topic: async () => '',
    hangUp: async () => undefined,
    log: async (entry) => void logged.push(entry),
    wake: () => undefined,
  };
  return {
    ports,
    files,
    started,
    signals,
    posts,
    placeRows,
    askRows,
    exits,
    logged,
    move: (ms: number) => {
      now = after(now, ms);
    },
  };
};

const paths = callsPaths({
  state: {
    shared: '/s/memory/shared',
    sharedFile: (name) => `/s/memory/shared/${name}`,
    capability: (owner) => `/s/memory/${owner}`,
    memory: (owner) => `/s/memory/${owner}`,
    private: (owner) => `/s/private/${owner}`,
    run: (owner) => `/s/run/${owner}`,
    log: (owner) => `/s/log/${owner}`,
  },
  join: (...parts) => parts.join('/'),
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('free, with a DM call: it joins it, asking Macro to fail rather than evict it', async () => {
  const { ports, started } = fakes();
  const state = watchState();
  const ms = await tick(base({ calls: [dm('a', cy)] }), state, ports);
  expect(started).toEqual([{ kind: 'channel', id: 'ch-a', callId: 'a' }]);
  expect(state.running.get('a')?.pid).toBe(501);
  expect(ms).toBe(pollMs);
});

test('a join this watcher started counts as the agent being in the call before its arguments show', async () => {
  const { ports, started } = fakes();
  const state = watchState();
  const w = base({ calls: [dm('a', cy), dm('b', cy)] });
  await tick(w, state, ports);
  await tick(w, state, ports);
  expect(started.map(({ callId }) => callId)).toEqual(['a']);
});

test("busy: the other caller is told once, in their channel, and a restart doesn't tell them again", async () => {
  const inA: InCall = { pid: 7, callId: 'a', args: ['channel', 'ch-a'] };
  const w = base({ calls: [dm('a', cy), dm('b', 'macro|ann@example.com')] });
  const first = fakes({ joins: [inA] });
  await tick(w, watchState(), first.ports);
  expect(first.posts).toHaveLength(1);
  expect(first.posts[0]?.[0]).toEqual({ channel: 'ch-b' });
  expect(first.files.has(paths.told('b'))).toBe(true);
  const again = fakes({ joins: [inA], told: ['b'] });
  await tick(w, watchState(), again.ports);
  expect(again.posts).toEqual([]);
  expect(again.started).toEqual([]);
});

test("the owner calls while it's on someone's call: the line is left for the join, it's signalled, and it joins only once it's out", async () => {
  const inA: InCall = { pid: 7, callId: 'a', args: ['channel', 'ch-a'] };
  const w = base({ calls: [dm('a', cy), dm('e', owner)] });
  const busy = fakes({ joins: [inA] });
  const state = watchState();
  expect(await tick(w, state, busy.ports)).toBe(leavePollMs);
  expect(busy.signals).toEqual([[7, 'SIGUSR2']]);
  expect(busy.files.get(paths.leave(7))).toBe(leaveLine.owner);
  expect(busy.started).toEqual([]);
  // Still there after 12 s: told to go. After 17 s: killed.
  busy.move(leaveTermMs);
  await tick(w, state, busy.ports);
  busy.move(leaveKillMs - leaveTermMs);
  await tick(w, state, busy.ports);
  expect(busy.signals.map(([, signal]) => signal)).toEqual([
    'SIGUSR2',
    'SIGTERM',
    'SIGKILL',
  ]);
});

test("a leave line nobody heard goes in the call's channel instead", async () => {
  const inA: InCall = { pid: 7, callId: 'a', args: ['channel', 'ch-a'] };
  const w = base({
    calls: [{ ...dm('a', cy), name: 'cy' }, dm('e', owner)],
  });
  const state = watchState();
  const busy = fakes({ joins: [inA] });
  await tick(w, state, busy.ports);
  // The join is gone and its leave file is still there. Leaving marked the call told, so no busy line follows.
  const gone = fakes({ told: ['a'] });
  gone.files.set(paths.leave(7), 'line');
  await tick(w, state, gone.ports);
  expect(gone.posts).toEqual([[{ channel: 'ch-a' }, leaveLine.owner]]);
  expect(gone.files.has(paths.leave(7))).toBe(false);
  expect(gone.started.map(({ callId }) => callId)).toEqual(['e']);
});

test("a join's exit is remembered: a failure retries soon, a refusal is counted, and the exit lands in the call's events", async () => {
  const { ports, exits, files, move } = fakes();
  const state = watchState();
  const w = base({ calls: [dm('a', cy)] });
  await tick(w, state, ports);
  move(2000);
  exits[0]?.(76);
  await settle();
  const tried = state.tries.get('a');
  expect(tried?.failures).toBe(1);
  expect(tried?.refusal).toBe('in_other_call');
  expect(tried?.refusals).toBe(1);
  expect(state.running.has('a')).toBe(false);
  expect(files.get(paths.events('a'))).toContain('"watch.join_exit"');
  expect(await tick(w, state, ports)).toBe(1000);
});

test('a call it was told to leave: its join there is stopped', async () => {
  const { ports, signals } = fakes({
    joins: [{ pid: 7, callId: 'a', args: ['channel', 'ch-a'] }],
  });
  await tick(
    base({ calls: [dm('a', cy)], hungUp: new Set(['a']) }),
    watchState(),
    ports
  );
  expect(signals).toEqual([[7, 'SIGTERM']]);
});

test('a placed call that went stale is closed in the ledger and its asker told by DM', async () => {
  const placed: Placed = {
    id: 'p1',
    channelId: 'ch-p',
    target: 'macro|ann@example.com',
    asker: cy,
    reason: 'The build is back.',
    rule: 'owner-order',
    at: at(-16 * 60_000),
  };
  const { ports, placeRows, posts } = fakes({ placed: [placed] });
  await tick(base(), watchState(), ports);
  expect(placeRows).toEqual([
    { id: 'p1', event: 'expired', why: 'never got to it' },
  ]);
  expect(posts[0]?.[0]).toEqual({ dm: cy });
});

test('a queued placed call is joined under its place- id', async () => {
  const placed: Placed = {
    id: 'p1',
    channelId: 'ch-p',
    target: cy,
    asker: cy,
    reason: 'Calling you back.',
    rule: 'call-back',
    at: at(0),
  };
  const { ports, started } = fakes({ placed: [placed] });
  await tick(base(), watchState(), ports);
  expect(started).toEqual([
    { kind: 'channel', id: 'ch-p', callId: `${placePrefix}p1` },
  ]);
});

test("the join the arbiter wants becomes the join capability's input", () => {
  expect(
    joinInput(
      {
        callId: 'c',
        args: ['channel', 'ch'],
        why: 'decided: about the roadmap',
        event: 'it chose to go',
        rank: 2,
        protects: false,
        urgent: false,
        tellAt: null,
        uninvited: true,
      },
      { onOtherCall: 'switch' }
    )
  ).toEqual({
    kind: 'channel',
    id: 'ch',
    callId: 'c',
    onOtherCall: 'switch',
    uninvited: 'decided: about the roadmap',
  });
});

// Keeps the AskRow import honest: the watcher writes rows the ledger's schema reads.
test('rows the watcher adds fit the ledger', () => {
  const row: NewAskRow = { id: 'x', event: 'moved' };
  const read: Pick<AskRow, 'id' | 'event'> = row;
  expect(read.event).toBe('moved');
});
