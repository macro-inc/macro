/**
 * The call watcher: every few seconds it reads the world and does what the
 * arbiter says (`arbiter.ts` has every rule). This file is the doing: which
 * joins are alive, the signals, the messages, the ledgers, and the log of
 * what was decided and why. All of it through ports, so a test can run a
 * tick against fakes.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import {
  arbitrate,
  type Decided,
  type InCall,
  type Insist,
  insist,
  type Join,
  type Leaving,
  type Notice,
  type Plan,
  rateLimitedMs,
  rejoinAt,
  type Tries,
  type Where,
  type World,
} from './arbiter.ts';
import type { Weigh, Weighed } from './asks.ts';
import {
  after,
  type CallsPaths,
  elapsed,
  joinCapability,
  noVoice,
  placePrefix,
} from './config.ts';
import { JoinInput } from './join.ts';
import { type CallApi, refusalOfExit } from './macro.ts';
import type { Asks, NewAskRow, NewPlaceRow, Placed } from './types.ts';

/** How often the world is read when nothing wakes the watcher sooner. */
export const pollMs = 3000;
/** While the agent is leaving a call, how often to look whether it's out. */
export const leavePollMs = 250;
/** It's had time to say why and go; now it's told to. */
export const leaveTermMs = 12_000;
/** And now it's killed, so it can't get stuck in a call it's leaving. */
export const leaveKillMs = 17_000;
/** The longest a message may hold up a tick: nobody waits for a slow send. */
export const noticeMs = 2000;
/** The stream of call events is reopened this often: the SDK doesn't say when one has gone quiet. */
export const streamRefreshMs = 60_000;
/** While calls are off for want of a speech key, how often the watcher looks for it again. */
export const idleMs = 60_000;

export type LeaveSignal = 'SIGUSR2' | 'SIGTERM' | 'SIGKILL';

/** The input of the join the arbiter wants. */
export const joinInput = (join: Join, how: Insist): JoinInput => ({
  kind: join.args[0],
  id: join.args[1],
  callId: join.callId,
  ...how,
  ...(join.uninvited === true ? { uninvited: join.why } : {}),
});

/** Give a join started by hand (no call id) its call id, if the world knows it. */
export const identify = (join: InCall, world: World): InCall => {
  if (join.callId !== null) return join;
  const [kind, id] = join.args;
  const found =
    kind === 'channel'
      ? world.calls.find(({ channelId }) => channelId === id)?.callId
      : world.meetings.find(({ token }) => token === id)?.callId;
  return { ...join, callId: found ?? null };
};

/** The next signal for a join that is leaving: first asked to say why and go, then told, then killed. `sent` is how many went out. */
export const leaveSignal = (
  now: Temporal.Instant,
  since: Temporal.Instant | undefined,
  sent = 0
): LeaveSignal | null => {
  if (since === undefined) return 'SIGUSR2';
  const waited = elapsed(now, since);
  if (waited >= leaveKillMs) return sent < 3 ? 'SIGKILL' : null;
  return waited >= leaveTermMs && sent < 2 ? 'SIGTERM' : null;
};

/**
 * A join process of this agent, read from a process's arguments: this
 * checkout's `cli.ts`, the join capability, and its JSON input. Exact
 * matches, so a shell that merely mentions a join doesn't count. This
 * checkout only: another agent may run its own joins on this machine under
 * its own identity, and an engineer's test join in a worktree isn't ours to
 * wait for or signal.
 */
export const parseJoin = (
  pid: number,
  argv: readonly string[],
  cli: string
): InCall | null => {
  const at = argv.indexOf(joinCapability);
  if (at < 1 || argv[at - 1] !== cli) return null;
  try {
    const input = JoinInput.safeParse(JSON.parse(argv[at + 1] ?? ''));
    return input.success
      ? {
          pid,
          callId: input.data.callId ?? null,
          args: [input.data.kind, input.data.id],
        }
      : null;
  } catch {
    return null;
  }
};

/**
 * Every join process alive from this checkout, read from the processes'
 * arguments. Not from a call's `pid` file: nothing removes one and pids get
 * reused, so a stale one would block every call and aim our signals at a
 * stranger.
 */
export const liveJoins = async (
  processes: () => Promise<
    readonly { readonly pid: number; readonly argv: readonly string[] }[]
  >,
  cli: string
): Promise<readonly InCall[]> =>
  (await processes()).flatMap(({ pid, argv }) => {
    const join = parseJoin(pid, argv, cli);
    return join === null ? [] : [join];
  });

/**
 * The world as the arbiter reads it. `ringing` is always false: Macro rings
 * every member on any channel call, so reading ring state honestly would
 * put the agent on every team channel call as "person calling". A plain channel
 * call is a judgment; a DM is answered by being a DM.
 */
export const world = async ({
  api,
  me,
  owner,
  allowed,
  hungUp,
}: {
  readonly api: Pick<CallApi, 'activeCalls' | 'meetings' | 'channel'>;
  readonly me: string;
  readonly owner: string;
  readonly allowed: () => Promise<ReadonlySet<string>>;
  readonly hungUp: () => Promise<ReadonlySet<string>>;
}): Promise<World> => {
  const [calls, meetings, allowedNow, hungUpNow] = await Promise.all([
    api.activeCalls(),
    api.meetings(),
    allowed(),
    hungUp(),
  ]);
  return {
    me,
    owner,
    calls: await Promise.all(
      calls.map(async (call) => ({
        ...call,
        ...(await api.channel(call.channelId)),
        ringing: false,
      }))
    ),
    meetings,
    allowed: allowedNow,
    hungUp: hungUpNow,
    judged: new Map(),
  };
};

/** How long to sleep before the next look: the poll, or sooner if a failed call's rejoin comes due. */
export const nextPollMs = (
  now: Temporal.Instant,
  tries: Iterable<Tries>
): number =>
  [...tries].reduce((ms, tried) => {
    const due = rejoinAt(tried);
    return due === undefined
      ? ms
      : Math.min(ms, Math.max(50, elapsed(due, now)));
  }, pollMs);

/** The wait before reopening the stream of call events after it failed: 1, 2, 4 ... 15 s. */
export const streamBackoffMs = (failures: number): number =>
  Math.min(1000 * 2 ** Math.max(0, failures - 1), 15_000);

/** Where each ask was made, so its answer goes back there: top level in a DM, in the thread elsewhere. */
export type AskedAt = { readonly channel: string; readonly root?: string };

/** What the watcher remembers between ticks. In memory: a restart starts clean and finds live joins from their processes. */
export type WatchState = {
  /** Joins this watcher started that are still running, by call id. */
  readonly running: Map<
    string,
    { readonly pid: number; readonly args: InCall['args'] }
  >;
  readonly tries: Map<string, Tries>;
  /** Joins it's been told to leave, by pid. */
  readonly leaving: Map<
    number,
    {
      readonly since: Temporal.Instant;
      readonly sent: number;
      readonly to: Leaving['to'];
      readonly callId: string | null;
      readonly line: string;
    }
  >;
  /** Asks at the model right now. */
  readonly weighing: Set<string>;
  /** The last action logged per call and event, so only a change of mind is logged. */
  readonly logged: Map<string, string>;
};

export const watchState = (): WatchState => ({
  running: new Map(),
  tries: new Map(),
  leaving: new Map(),
  weighing: new Set(),
  logged: new Map(),
});

export type WatchPorts = {
  readonly clock: Clock;
  readonly paths: Pick<CallsPaths, 'told' | 'leave' | 'events'>;
  readonly disk: {
    readonly exists: (path: string) => Promise<boolean>;
    readonly read: (path: string) => Promise<string | undefined>;
    readonly write: (path: string, text: string) => Promise<void>;
    readonly append: (path: string, text: string) => Promise<void>;
    readonly remove: (path: string) => Promise<void>;
  };
  /** Every join process alive from this checkout. */
  readonly joins: () => Promise<readonly InCall[]>;
  /** Starts a join as its own process, which outlives this one. */
  readonly start: (input: JoinInput) => Promise<{
    readonly pid: number;
    readonly exited: Promise<number>;
  }>;
  /** Signals a process. Nothing happens if it's gone. */
  readonly signal: (pid: number, signal: LeaveSignal) => void;
  /** Posts in a channel, or a DM with a person. */
  readonly post: (to: Where, text: string) => Promise<void>;
  /** Replies in a thread. */
  readonly reply: (
    channel: string,
    root: string,
    text: string
  ) => Promise<void>;
  /** The join judgment: started here, read on a later tick. Never waits. */
  readonly judgments: {
    readonly tick: (
      world: World,
      inCall: ReadonlySet<string>,
      busy: boolean,
      now: Temporal.Instant
    ) => void;
    readonly verdicts: () => ReadonlyMap<
      string,
      { readonly join: boolean; readonly reason: string }
    >;
  };
  readonly placed: {
    readonly pending: () => Promise<readonly Placed[]>;
    readonly add: (row: NewPlaceRow) => Promise<void>;
    /** What whoever asked for a call is told when it never rang. */
    readonly expiredLine: (target: string) => string;
  };
  readonly asks: {
    readonly read: () => Promise<
      Asks & { readonly where: ReadonlyMap<string, AskedAt> }
    >;
    readonly add: (row: NewAskRow) => Promise<void>;
  };
  /** The switch judgment: one model call. */
  readonly weigh: Weigh;
  /** What's been said on a call, from its event log. */
  readonly topic: (callId: string) => Promise<string>;
  /** Marks a call so the agent never rejoins it. */
  readonly hangUp: (callId: string) => Promise<void>;
  /** Every decision, for the log you can read back. */
  readonly log: (entry: object) => Promise<void>;
  /** Wakes the watcher before its next poll. */
  readonly wake: () => void;
};

/** Resolves when `work` does, or after `ms`, whichever is first. */
const within = (
  work: Promise<unknown>,
  ms: number,
  clock: Pick<Clock, 'sleep'>
): Promise<unknown> => Promise.race([work, clock.sleep(ms)]);

/** Every decision with its reason, once per change of mind per call. */
const logDecisions = async (
  decisions: readonly Decided[],
  last: Map<string, string>,
  log: WatchPorts['log']
): Promise<void> => {
  for (const decision of decisions) {
    const key = `${decision.callId}|${decision.event}`;
    if (last.get(key) === decision.action) continue;
    last.set(key, decision.action);
    await log(decision);
  }
};

/** Posts a notice, marked first so a slow send can't repeat it; a failed one is unmarked, and so retried next tick. */
const send = async (
  { paths, disk, post, log, clock }: WatchPorts,
  notice: Notice
): Promise<void> => {
  const told = paths.told(notice.callId);
  await disk.write(told, notice.text);
  const posted = post(notice.to, notice.text).then(
    () =>
      log({
        told: notice.callId,
        by: 'channel' in notice.to ? 'channel' : 'dm',
      }),
    async (error: unknown) => {
      await log({ tell_failed: notice.callId, error: String(error) });
      await disk.remove(told);
    }
  );
  // Never hold up the watch loop for a message.
  await within(posted, noticeMs, clock);
};

/** How the agent came to be on the call it's in, for the switch judgment. Never what it's about. */
const currentCall = (current: Join | null): string =>
  current?.uninvited === true
    ? 'The agent chose to sit in on this call; nobody there asked for it.'
    : current?.callId.startsWith(placePrefix) === true
      ? 'The agent placed this call.'
      : 'Someone called the agent on this call.';

const weighAsks = (
  { weigh, topic, asks, wake }: WatchPorts,
  { weighing }: WatchState,
  world: World,
  plan: Plan,
  here: InCall
): void => {
  for (const ask of plan.weigh) {
    // Off the loop, like the join judgment: the verdict lands on a later tick.
    weighing.add(ask.id);
    const [kind, id] = here.args;
    const room =
      world.calls.find(
        ({ channelId }) => kind === 'channel' && channelId === id
      )?.callId ??
      here.callId ??
      '';
    void topic(room)
      .then((said) =>
        weigh({
          name: ask.name,
          words: ask.text,
          topic: said,
          current: currentCall(plan.current),
        })
      )
      .catch(
        (error: unknown): Weighed => ({
          go: false,
          reason: `judgment failed: ${error}`,
          need: '',
          by: 'rule',
        })
      )
      .then((verdict) =>
        asks.add({
          id: ask.id,
          event: 'weighed',
          verdict: { ...verdict, current: here.callId },
        })
      )
      .catch(() => undefined)
      .finally(() => {
        weighing.delete(ask.id);
        wake();
      });
  }
};

const startJoin = async (
  ports: WatchPorts,
  { running, tries }: WatchState,
  join: Join
): Promise<void> => {
  const { clock, disk, paths, placed, hangUp, log, wake } = ports;
  const before = tries.get(join.callId) ?? { failures: 0 };
  const spawnedAt = clock.now();
  tries.set(join.callId, { ...before, lastTry: spawnedAt });
  void log({
    joining: join.callId,
    why: join.why,
    ...(before.failures > 0 ? { retry: before.failures } : {}),
  });
  const started = await ports.start(joinInput(join, insist(join, before)));
  running.set(join.callId, { pid: started.pid, args: join.args });
  void started.exited
    .then(async (code) => {
      running.delete(join.callId);
      const exited = clock.now();
      const tried = tries.get(join.callId) ?? { failures: 0 };
      const refused = refusalOfExit(code);
      tries.set(join.callId, {
        ...tried,
        lastExit: exited,
        refusal: refused,
        refusals:
          refused === undefined
            ? 0
            : refused === tried.refusal
              ? (tried.refusals ?? 0) + 1
              : 1,
        delayUntil:
          refused === 'rate_limited' ? after(exited, rateLimitedMs) : undefined,
        failures: code === 0 ? 0 : tried.failures + 1,
      });
      await log({ left: join.callId, exit: code });
      // A placed call whose join ended cleanly is over, whatever its own rows say.
      if (code === 0 && join.callId.startsWith(placePrefix)) {
        const id = join.callId.slice(placePrefix.length);
        if ((await placed.pending()).some((pending) => pending.id === id))
          await placed.add({ id, event: 'ended', why: 'join exited' });
      }
      // It chose to go, and now it's out: however it ended, it doesn't invite itself back.
      if (join.uninvited === true && code === 0) await hangUp(join.callId);
      // In the call's own event log, so its report shows failed joins.
      await disk.append(
        paths.events(join.callId),
        `${JSON.stringify({
          t: Math.round(elapsed(exited, spawnedAt)),
          type: 'watch.join_exit',
          code,
          failures: tries.get(join.callId)?.failures ?? 0,
          why: join.why,
        })}\n`
      );
    })
    .catch((error: unknown) =>
      log({ join_exit_failed: join.callId, error: String(error) })
    )
    // The slot is free: someone may be waiting, and a failed join re-plans the sleep.
    .finally(wake);
};

const leave = async (
  { clock, disk, paths, asks, signal, log }: WatchPorts,
  { leaving }: WatchState,
  plan: Leaving
): Promise<void> => {
  if (plan.ask !== null && !plan.joins.some(({ pid }) => leaving.has(pid)))
    await asks.add({ id: plan.ask, event: 'moved' });
  for (const join of plan.joins) {
    const was = leaving.get(join.pid);
    const now = clock.now();
    const next = leaveSignal(now, was?.since, was?.sent);
    if (next === null) continue;
    await log({
      leaving: join.callId ?? join.pid,
      signal: next,
      line: plan.line,
    });
    if (was === undefined) {
      // The join can't be reached from here, so the line is left where it reads it.
      await disk.write(paths.leave(join.pid), plan.line);
      // They've heard why; no busy line on top of it.
      if (plan.callId !== null)
        await disk.write(paths.told(plan.callId), plan.line);
      leaving.set(join.pid, {
        since: now,
        sent: 1,
        to: plan.to,
        callId: plan.callId,
        line: plan.line,
      });
    } else leaving.set(join.pid, { ...was, sent: was.sent + 1 });
    signal(join.pid, next);
  }
};

/**
 * One tick: read what's alive, ask the arbiter, and do what it says.
 * Returns how long to sleep before the next one.
 */
export const tick = async (
  read: World,
  state: WatchState,
  ports: WatchPorts
): Promise<number> => {
  const { clock, disk, paths, placed, asks, judgments, log } = ports;
  const { running, tries, leaving, weighing, logged } = state;
  // Ours first: a join just started may not show its arguments yet.
  const found = await ports.joins();
  const joins = [
    ...found,
    ...[...running].flatMap(([callId, { pid, args }]) =>
      found.some((join) => join.pid === pid) ? [] : [{ pid, callId, args }]
    ),
  ].map((join) => identify(join, read));

  judgments.tick(
    read,
    new Set(joins.flatMap(({ callId }) => (callId === null ? [] : [callId]))),
    joins.length > 0,
    clock.now()
  );
  const ledger = await asks.read();
  const world: World = {
    ...read,
    judged: judgments.verdicts(),
    placed: await placed.pending(),
    asks: ledger,
    weighing,
  };
  const told = new Map(
    await Promise.all(
      [
        ...world.calls.map(({ callId }) => callId),
        ...world.meetings.map(({ callId }) => callId),
      ].map(async (id) => [id, await disk.exists(paths.told(id))] as const)
    )
  );
  const plan = arbitrate(
    world,
    joins,
    clock.now(),
    tries,
    (id) => told.get(id) === true
  );
  await logDecisions(plan.decisions, logged, log);

  for (const close of plan.closePlaced) {
    await placed.add({ id: close.id, event: close.event, why: close.why });
    const asker = close.placed.asker;
    // Whoever asked for a call that never rang hears so.
    if (
      (close.event === 'expired' ||
        /join (rate_limited|refused)/.test(close.why)) &&
      asker !== null
    )
      await send(ports, {
        callId: `${placePrefix}${close.id}`,
        to: { dm: asker },
        text: placed.expiredLine(close.placed.target),
      });
  }
  for (const { ask, line } of plan.answers) {
    // Marked first, like a notice: a slow send can't repeat.
    await asks.add({ id: ask.id, event: 'answered', line });
    const at = ledger.where.get(ask.id);
    if (at === undefined) continue;
    const answered =
      at.root === undefined
        ? ports.post({ channel: at.channel }, line)
        : ports.reply(at.channel, at.root, line);
    await within(
      answered.catch((error: unknown) =>
        log({ answer_failed: ask.id, error: String(error) })
      ),
      noticeMs,
      clock
    );
  }
  for (const { ask, why } of plan.closeAsks)
    await asks.add({ id: ask.id, event: 'closed', why });
  const here = joins[0];
  if (here !== undefined) weighAsks(ports, state, world, plan, here);

  for (const notice of plan.tell) await send(ports, notice);
  // Gone, whichever way: if the line wasn't heard, it goes in the call's channel instead.
  for (const [pid, left] of leaving) {
    if (joins.some((join) => join.pid === pid)) continue;
    if (
      (await disk.exists(paths.leave(pid))) &&
      left.callId !== null &&
      left.to !== null
    )
      await send(ports, { callId: left.callId, to: left.to, text: left.line });
    await disk.remove(paths.leave(pid));
    leaving.delete(pid);
  }
  if (plan.leaving !== null) await leave(ports, state, plan.leaving);
  if (plan.join !== null) await startJoin(ports, state, plan.join);

  // Told to hang up: stop now (the join also exits by itself).
  for (const join of joins)
    if (join.callId !== null && world.hungUp.has(join.callId))
      ports.signal(join.pid, 'SIGTERM');

  const live = new Set([
    ...world.calls.map(({ callId }) => callId),
    ...world.meetings.map(({ callId }) => callId),
    ...(world.placed ?? []).map(({ id }) => `${placePrefix}${id}`),
  ]);
  for (const id of tries.keys())
    if (!live.has(id) && !running.has(id)) tries.delete(id);

  return leaving.size > 0
    ? leavePollMs
    : nextPollMs(clock.now(), tries.values());
};

/** Something to sleep on that can be woken early. */
export type Pulse = {
  /** Resolves after `ms`, or as soon as `wake` is called. */
  readonly wait: (ms: number) => Promise<void>;
  readonly wake: () => void;
};

export const pulse = (clock: Pick<Clock, 'sleep'>): Pulse => {
  let woken: (() => void) | undefined;
  return {
    wait: (ms) =>
      Promise.race([
        clock.sleep(ms),
        new Promise<void>((resolve) => {
          woken = resolve;
        }),
      ]),
    wake: () => woken?.(),
  };
};

/**
 * Keeps the stream of call events open, so a call is seen as it starts and
 * not at the next poll. Reopened every minute, and after a failure with a
 * growing wait. Runs until `stopped` says so.
 */
export const followCalls = async ({
  watch,
  wake,
  clock,
  failed,
  stopped = () => false,
}: {
  readonly watch: CallApi['watch'];
  readonly wake: () => void;
  readonly clock: Pick<Clock, 'sleep'>;
  /** Told when the stream couldn't be opened, for the log. */
  readonly failed: (error: unknown) => void;
  readonly stopped?: () => boolean;
}): Promise<void> => {
  let failures = 0;
  while (!stopped()) {
    try {
      const stop = await watch({ changed: wake, up: () => wake() });
      failures = 0;
      await clock.sleep(streamRefreshMs);
      stop();
    } catch (error) {
      failed(error);
      failures += 1;
    }
    if (!stopped()) await clock.sleep(streamBackoffMs(failures));
  }
};

/** What the watcher's reading of the world runs on. */
export type WorldPorts = {
  /** Whether calls can run: the speech key is there. Asked before every read. */
  readonly ready: () => Promise<boolean>;
  readonly read: () => Promise<World>;
  readonly pulse: Pick<Pulse, 'wait'>;
  /** How long to sleep after a reading; the handler's tick sets it before this resumes. */
  readonly next: { ms: number };
  /** For the log: calls going off or on, and reads that failed. */
  readonly log: (entry: object) => void;
};

/**
 * The world, read again every few seconds and sooner when woken. Without
 * the speech key nothing is read and nothing is yielded, so the watcher
 * joins nothing it couldn't hear: it says so once in the log and looks
 * again every minute, so a key added later turns calls on without a
 * restart. A read that fails is logged and tried again at the next poll.
 */
export async function* worlds(ports: WorldPorts): AsyncGenerator<World> {
  let off = false;
  for (;;) {
    if (!(await ports.ready().catch(() => false))) {
      if (!off) ports.log({ calls: 'off', why: noVoice });
      off = true;
      await ports.pulse.wait(idleMs);
      continue;
    }
    if (off) ports.log({ calls: 'on' });
    off = false;
    const read = await ports.read().catch((error: unknown) => {
      ports.log({ read_error: String(error) });
      return undefined;
    });
    ports.next.ms = pollMs;
    if (read !== undefined) yield read;
    await ports.pulse.wait(ports.next.ms);
  }
}

/** The watcher's parts, made once and shared by its source and its handler. */
export type Watcher = {
  readonly state: WatchState;
  readonly ports: WatchPorts;
  readonly pulse: Pulse;
  /** How long the source sleeps before its next look; the handler sets it after each tick. */
  readonly next: { ms: number };
  /** What the source reads the world with. */
  readonly api: CallApi;
  readonly allowed: () => Promise<ReadonlySet<string>>;
  readonly hungUp: () => Promise<ReadonlySet<string>>;
};
