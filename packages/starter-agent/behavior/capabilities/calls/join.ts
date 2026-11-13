/**
 * The agent in one call: the process `bin/agent joinCall '<json>'` runs.
 * Room audio goes to a LiveKit AgentSession (VAD, STT, turns, interruptions,
 * TTS, playout) with one Claude Code session as its brain, and out on the
 * agent's track. Everything lands in the call's log directory: its events from t=0,
 * and a WAV per voice.
 *
 * This is the orchestration, over ports: `context/voice.ts` builds the real
 * ones, and the tests run it against fakes.
 */

import type { Room } from '@livekit/rtc-node';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import type { Trace } from '../../agent/claude.ts';
import type { Disk } from '../../context/disk.ts';
import { ringMs } from './arbiter.ts';
import { type Brain, type BrainNeeds, uninvitedNote } from './brain.ts';
import { type CallsPaths, placePrefix } from './config.ts';
import { type EventLog, type TrackRecorder, watchLoop } from './events.ts';
import type { IdList } from './ledger.ts';
import {
  type CallApi,
  type Connection,
  type JoinRequest,
  refusal,
  refusalExits,
} from './macro.ts';
import { type RetryOptions, retry, roomConnect, tokenRetry } from './retry.ts';
import {
  agentVoice,
  type CallRoom,
  inRate,
  nobody,
  type RoomHandlers,
} from './room.ts';
import {
  type Addressing,
  addressing,
  type CallScreen,
  onlyWhatsForAgent,
  type Speakers,
  type Speech,
  sayBeforeLeaving,
} from './session.ts';
import {
  type CallEvent,
  type Emit,
  JoinKind,
  type MakeShare,
  type NewPlaceRow,
  type Placed,
  type Speaker,
} from './types.ts';

/** What the agent says as it comes in, so people know it's there. */
export const greeting = (name: string): string => `Hi, it's ${name}.`;
/** On a call it chose to join: one line saying who it is, then its name only. */
export const uninvitedGreeting = (name: string): string =>
  `It's ${name}. I'll stay quiet unless someone says my name.`;
/** The agent leaves this long after the last human, */
export const aloneMs = 30_000;
/** or this long after joining if nobody came. A call it placed rings for `ringMs` instead. */
export const nobodyMs = 60_000;
/** They've joined; their client needs a moment to subscribe to the agent before the first word. */
export const openDelayMs = 800;
/** `connection.leave()` is waited for this long: the helper's own doesn't wait, and exiting would cut it off. */
export const leaveSeatMs = 3000;
/** After hang_up: the goodbye is still in flight when the tool fires, */
const goodbyeStartMs = 300;
/** and it gets this long to finish playing. */
const goodbyeMostMs = 8000;
const goodbyePollMs = 100;
const aloneCheckMs = 1000;
/** The exit code of a join that failed for a reason Macro didn't name. */
export const failedExit = 1;

/** A join's input, parsed again from a join process's arguments by the watcher. */
export const JoinInput = z.object({
  kind: JoinKind,
  /** The channel's id, or the meeting's invitation token. */
  id: z.string().min(1),
  /** The live call, which the watcher passes so events start before the room; `place-<id>` for a call it is placing. */
  callId: z.string().optional(),
  /** Nobody asked the agent here: the reason it chose to go. */
  uninvited: z.string().optional(),
  /** Leave the call it's in for this one. Only when the arbiter decided so. */
  onOtherCall: z.literal('switch').optional(),
  /** Disconnect a connection this identity already has. Only when no join of its own is alive. */
  replace: z.boolean().optional(),
  /** Also print every event. */
  echo: z.boolean().optional(),
});
export type JoinInput = z.infer<typeof JoinInput>;

/** How a join ended. `code` is what the process exits with: the watcher reads why from it. */
export type Outcome = {
  readonly callId?: string;
  readonly dir?: string;
  readonly code: number;
  readonly why: string;
};

/** The outbound ledger, as much as a call the agent is placing needs. */
export type Outbound = {
  /** The call it was asked to place and hasn't finished, seated under this id (`place-<ledger id>`). */
  readonly pending: (callId: string) => Promise<Placed | undefined>;
  readonly add: (row: NewPlaceRow) => Promise<void>;
};

/** The voice session of one call. */
export type CallSession = Speech & {
  /** Starts hearing and speaking in the connected room. */
  readonly start: (room: Room) => Promise<void>;
  /** Whether the agent is speaking, or about to. */
  readonly busy: () => boolean;
  /**
   * One 20 ms frame of a human's microphone, at the room's rate. Once two
   * humans are in, each gets a listener of their own, so it hears everyone,
   * not only the person the session is linked to.
   */
  readonly hear: (who: string, name: string, frame: Int16Array) => void;
  /** Someone left: their listener goes. */
  readonly gone: (who: string) => void;
  readonly close: () => Promise<void>;
};

export type SessionNeeds = {
  readonly brain: Brain;
  readonly speakers: Speakers;
  readonly addressing: Addressing;
  readonly emit: Emit;
  /** Milliseconds since the join started. */
  readonly now: () => number;
  readonly card: (who: string, alone: boolean) => Promise<string>;
};

/** The people area, as much as a call uses: what the agent knows of whoever is speaking. Never throws. */
export type CallPeople = {
  readonly cards: (
    ids: readonly string[],
    purpose: 'call',
    options?: { readonly alone?: boolean }
  ) => Promise<string>;
};

/** What the people area's `appraiseCall` capability is given: the call, and what was said on it. */
export type Appraisal = {
  readonly callId: string;
  /** The channel of a channel's call. */
  readonly channelId?: string;
  /** The call's event log lines that say what was said: `turn.heard` (who, text) and `brain.text` (text). */
  readonly events: readonly CallEvent[];
};

/** The events an appraisal reads. */
const saidEvents: readonly string[] = ['turn.heard', 'brain.text'];

/** What a call takes from LiveKit. */
export type CallKit = {
  /** Watches a connected room. */
  readonly room: (room: Room, emit: Emit, handlers: RoomHandlers) => CallRoom;
  readonly session: (needs: SessionNeeds) => Promise<CallSession>;
  /** Releases LiveKit's native side. */
  readonly dispose: () => Promise<void>;
};

export type LeaveSignal = 'SIGUSR2' | 'SIGTERM' | 'SIGINT';

/** This process, as much as a join touches. */
export type Proc = {
  readonly pid: number;
  /** A line on stdout. */
  readonly print: (line: string) => void;
  /** A line on stderr. */
  readonly complain: (line: string) => void;
  readonly onSignal: (signal: LeaveSignal, handle: () => void) => void;
};

export type JoinPorts = {
  /** Spans: leaving is one, with why. */
  readonly trace: Trace;
  /** The agent's name: how it greets, and what it answers to. */
  readonly name: string;
  readonly api: Pick<CallApi, 'join' | 'publishScreen'>;
  /** Makes Macro ready (its key decrypted), so the token request's deadline is spent on the request. */
  readonly secrets: () => Promise<void>;
  readonly outbound: Outbound;
  /** Tells the person it rang, and whoever asked, that nobody picked up. */
  readonly tellNoAnswer: (placed: Placed) => Promise<void>;
  /** What the agent opens a call it placed with, from its reason. */
  readonly openingLine: (reason: string) => string;
  /** Calls the agent was told to leave: never rejoined. */
  readonly hungUp: Pick<IdList, 'add'>;
  readonly makeShare?: MakeShare;
  readonly people: CallPeople;
  /** Macro's `ai.decide`, for whether a line on a group call is for the agent. Without it, only the rule: its name, or a follow-up. */
  readonly screen?: CallScreen;
  /** Hands a finished call to the people area, in a process that outlives this one. */
  readonly appraise: (call: Appraisal) => void;
  readonly clock: Clock;
  /** Monotonic milliseconds. */
  readonly monotonic: () => number;
  readonly paths: CallsPaths;
  readonly disk: Pick<Disk, 'read' | 'write' | 'remove'>;
  readonly proc: Proc;
  readonly log: (needs: {
    readonly file?: string;
    readonly elapsed: () => number;
    readonly echo?: (line: string) => void;
  }) => EventLog;
  readonly recorder: (needs: {
    readonly path: string;
    readonly rate: number;
    readonly log: EventLog;
    readonly who: string;
  }) => TrackRecorder;
  readonly brain: (needs: BrainNeeds) => Brain;
  /** LiveKit, loaded when a call needs it: nothing else in the agent's process pays for its native libraries. */
  readonly livekit: () => Promise<CallKit>;
};

/**
 * The seat in the call, retried with a deadline per attempt; every attempt is
 * an event. A token request can hang for most of a minute, and a caller
 * hears nothing meanwhile. A refusal is Macro's answer, so it isn't retried.
 */
export const seat = (
  api: Pick<CallApi, 'join'>,
  request: JoinRequest,
  emit: Emit,
  clock: Clock,
  options: RetryOptions = tokenRetry
): Promise<Connection> =>
  retry(() => api.join(request), {
    ...options,
    clock,
    shouldRetry: (error) => refusal(error) === null,
    onAttempt: (attempt) => emit('join.token', { ...attempt }),
  });

/** Why the agent should leave now, if it should: 30 s after the last human, 60 s if nobody came, the ring time if nobody answered. */
export const leaveReason = ({
  humanCame,
  placing,
  aloneForMs,
}: {
  readonly humanCame: boolean;
  readonly placing: boolean;
  readonly aloneForMs: number;
}): string | undefined => {
  if (humanCame) return aloneForMs > aloneMs ? 'everyone left' : undefined;
  if (placing) return aloneForMs > ringMs ? 'no answer' : undefined;
  return aloneForMs > nobodyMs ? 'nobody came' : undefined;
};

const ignore = () => undefined;
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Joins one call and resolves when it is over, with the code the process
 * should exit with.
 */
export const joinCall = async (
  ports: JoinPorts,
  input: JoinInput
): Promise<Outcome> => {
  const { api, outbound, hungUp, clock, disk, paths, proc, monotonic } = ports;
  const { kind, id } = input;
  const uninvited = input.uninvited !== undefined;
  const began = monotonic();
  const elapsed = () => monotonic() - began;
  const openLog = (callId: string | undefined) =>
    ports.log({
      file: callId === undefined ? undefined : paths.events(callId),
      elapsed,
      echo: input.echo === true ? proc.print : undefined,
    });
  // With the watcher's call id, events start now, so a join that fails before
  // the room still shows in the call's report.
  let log = openLog(input.callId);
  if (input.callId !== undefined)
    await disk.write(paths.pid(input.callId), String(proc.pid)).catch(ignore);

  const failed = (
    stage: string,
    error: unknown,
    where: { readonly callId?: string; readonly dir?: string } = {}
  ): Outcome => {
    const reason = refusal(error);
    if (reason === 'ended') {
      // The call is over: nothing failed, and there is nothing to retry.
      log.emit('join.gone', { stage });
      log.close();
      return { ...where, code: refusalExits.ended, why: 'the call ended' };
    }
    if (reason !== null) log.emit('join.refusal', { reason, stage });
    log.emit('join.failed', { stage, error: message(error) });
    log.close();
    proc.complain(`join failed (${stage}): ${message(error)}`);
    return {
      ...where,
      code: reason === null ? failedExit : refusalExits[reason],
      why: `join failed (${stage}): ${reason ?? message(error)}`,
    };
  };

  log.emit('join.start', { kind, id, pid: proc.pid });
  try {
    await ports.secrets();
    log.emit('join.secrets', { ms: Math.round(elapsed()) });
  } catch (error) {
    return failed('secrets', error);
  }

  // A call it's placing (`place-<id>`): the token request below is what rings them.
  const placing = input.callId?.startsWith(placePrefix) === true;
  const placed =
    placing && input.callId !== undefined
      ? await outbound.pending(input.callId).catch(ignore)
      : undefined;
  if (placing && placed === undefined)
    return failed('place', new Error(`no pending ${input.callId}`));

  // The token request evicts the agent from anything else this identity is in, so
  // it fails on another call unless the arbiter said to switch. A join by
  // call id can't start a call: only a placed one may ring anybody.
  let connection: Connection;
  try {
    connection = await seat(
      api,
      {
        kind,
        id,
        callId: placing ? undefined : input.callId,
        placed: placing ? true : undefined,
        onOtherCall: input.onOtherCall ?? 'fail',
        replace: input.replace,
      },
      log.emit,
      clock
    );
  } catch (error) {
    return failed('token', error);
  }

  const callId = connection.callId;
  const dir = paths.call(callId);
  const where = { callId, dir };
  const leaveSeat = () =>
    Promise.race([connection.leave().catch(ignore), clock.sleep(leaveSeatMs)]);

  if (placed !== undefined)
    await outbound
      .add({ id: placed.id, event: 'joined', callId })
      .catch(ignore);
  if (input.callId === undefined || placed !== undefined) {
    // The room's id is only known now: the rest goes in its directory.
    log.close();
    log = openLog(callId);
    await disk.write(paths.pid(callId), String(proc.pid)).catch(ignore);
  }
  // What was said, kept for the people area as the log has it: uninvited,
  // that is only what was said to the agent.
  const said: CallEvent[] = [];
  const logged: Emit = (type, data) => {
    if (saidEvents.includes(type)) said.push({ t: log.now(), type, ...data });
    log.emit(type, data);
  };
  const emit = uninvited ? onlyWhatsForAgent(logged) : logged;
  emit('call.start', { kind, id, room: callId, pid: proc.pid });
  const stopLoopWatch = watchLoop(log.emit, monotonic);
  // The call id, so the watcher can map its process to the call.
  proc.print(JSON.stringify(where));

  const recorders = new Map<string, TrackRecorder>();
  const record = (who: string, frame: Int16Array) => {
    const recorder =
      recorders.get(who) ??
      ports.recorder({
        path: paths.recording(callId, who),
        rate: inRate,
        log,
        who,
      });
    recorders.set(who, recorder);
    recorder.write(frame);
  };

  const over = Promise.withResolvers<Outcome>();
  let live: Room | undefined;
  let kit: CallKit | undefined;
  let room: CallRoom | undefined;
  let session: CallSession | undefined;
  let finished = false;
  let started = false;
  let opened = false;
  // Who's here: the agent leaves 30 s after the last human, or 60 s if nobody came.
  let humanHere = false;
  let aloneSince: number | undefined = monotonic();

  const speaker = (): Speaker | undefined =>
    room === undefined
      ? undefined
      : { id: room.lastSpeaker()[0], alone: room.humans().length === 1 };

  /** What the call showed about the people on it, for the people area. */
  const appraise = async () => {
    const channelId = kind === 'channel' ? id : undefined;
    ports.appraise({ callId, channelId, events: said });
  };

  const finish = async (why: string): Promise<void> => {
    if (finished) return;
    finished = true;
    await ports.trace('calls.leave', async (span) => {
      span.set('call.id', callId);
      span.set('call.leave_reason', why);
      span.set('call.human_joined', humanHere);
      await leaving(why);
    });
  };

  const leaving = async (why: string): Promise<void> => {
    emit('call.leave', { why });
    clearInterval(aloneCheck);
    stopLoopWatch();
    if (placed !== undefined) {
      await outbound
        .add({
          id: placed.id,
          event: humanHere ? 'ended' : 'no_answer',
          callId,
          why,
        })
        .catch(ignore);
      if (!humanHere) await ports.tellNoAnswer(placed).catch(ignore);
    }
    await share?.stop().catch(ignore);
    await session?.close().catch(ignore);
    await room?.leave();
    await leaveSeat();
    await brain.close().catch(ignore);
    for (const recorder of recorders.values()) recorder.close();
    emit('call.end');
    log.close();
    await appraise().catch(ignore);
    await kit?.dispose().catch(ignore);
    over.resolve({ ...where, code: 0, why });
  };

  const aloneCheck = setInterval(() => {
    if (aloneSince === undefined) return;
    const why = leaveReason({
      humanCame: humanHere,
      placing: placed !== undefined,
      aloneForMs: monotonic() - aloneSince,
    });
    if (why !== undefined) void finish(why);
  }, aloneCheckMs);

  // Every limit on what sharing shows is the share part's; a call only hands it the room and the voice.
  const share = ports.makeShare?.({
    room: () => {
      if (live === undefined) throw new Error("the room isn't connected yet");
      return live;
    },
    publish: api.publishScreen,
    say: (line) =>
      session === undefined
        ? Promise.reject(new Error('no voice yet'))
        : session.say(line),
    uninvited,
    emit,
  });

  const leaveAfterGoodbye = async () => {
    await hungUp.add(callId).catch(ignore);
    const until = monotonic() + goodbyeMostMs;
    await clock.sleep(goodbyeStartMs);
    while (monotonic() < until && session?.busy() === true)
      await clock.sleep(goodbyePollMs);
    await finish('hang_up tool');
  };

  const brain = ports.brain({
    callId,
    channel: kind === 'channel' ? id : undefined,
    placed:
      placed === undefined
        ? undefined
        : {
            target: placed.target,
            asker: placed.asker,
            opening: ports.openingLine(placed.reason),
          },
    note:
      input.uninvited === undefined
        ? undefined
        : uninvitedNote(input.uninvited),
    speaker,
    share,
    emit,
    onHangUp: () => void leaveAfterGoodbye(),
  });
  const warm = brain
    .start()
    .catch((error: unknown) =>
      emit('brain.error', { error: `start: ${message(error)}` })
    );

  // It says why as soon as they're on; a placed call has nobody to greet until then.
  // The opening is the voice's own `say`, not the brain: the reason is already written.
  const open = () => {
    const speech = session;
    if (
      placed === undefined ||
      opened ||
      !started ||
      !humanHere ||
      speech === undefined
    )
      return;
    opened = true;
    setTimeout(
      () => void speech.say(ports.openingLine(placed.reason)).catch(ignore),
      openDelayMs
    );
  };

  /** Display names, for the transcript the screen reads. */
  const names = new Map<string, string>();
  const handlers: RoomHandlers = {
    joined: (who, name) => {
      names.set(who, name);
      if (placed !== undefined && !humanHere) {
        void outbound
          .add({ id: placed.id, event: 'answered', callId })
          .catch(ignore);
        emit('call.answered');
      }
      humanHere = true;
      aloneSince = undefined;
      open();
    },
    left: (who) => {
      session?.gone(who);
      if (room?.humans().length === 0) aloneSince = monotonic();
    },
    // Uninvited, no voice is kept: these people didn't ask for the agent.
    audio: (who, frame) => {
      if (!uninvited) record(who, frame);
      // Its own voice comes here too, for the recording; it doesn't listen to itself.
      if (who !== agentVoice) session?.hear(who, names.get(who) ?? who, frame);
    },
    ownVoice: agentVoice,
    disconnected: (reason) => void finish(`disconnected: ${reason}`),
  };

  // The watcher moving the agent: say why to the people here, then go. No line, or nobody to hear it: just go.
  const leaveSaying = async () => {
    const file = paths.leave(proc.pid);
    const line = (await disk.read(file).catch(ignore)) ?? '';
    const said =
      line === '' ||
      !started ||
      session === undefined ||
      (await sayBeforeLeaving({
        line,
        speech: session,
        humans: room?.humans().length ?? 0,
        emit,
        sleep: clock.sleep,
      }));
    // What's left, the watcher posts in the call's channel instead.
    if (said) await disk.remove(file).catch(ignore);
    await finish(`moving: ${line}`);
  };
  proc.onSignal('SIGUSR2', () => void leaveSaying());
  proc.onSignal('SIGTERM', () => void finish('SIGTERM'));
  proc.onSignal('SIGINT', () => void finish('SIGINT'));

  /** A join that got a seat and then couldn't use it: give the seat back, so Macro doesn't hold the agent "in" this call. */
  const abandon = async (stage: string, error: unknown): Promise<Outcome> => {
    finished = true;
    clearInterval(aloneCheck);
    stopLoopWatch();
    await session?.close().catch(ignore);
    await room?.leave();
    await leaveSeat();
    await brain.close().catch(ignore);
    for (const recorder of recorders.values()) recorder.close();
    return failed(stage, error, where);
  };

  let voice: CallSession;
  try {
    kit = await ports.livekit();
    voice = await kit.session({
      brain,
      speakers: {
        humans: () => room?.humans().length ?? 0,
        current: () => room?.lastSpeaker() ?? nobody,
      },
      addressing: addressing({
        name: ports.name,
        nameOnly: uninvited,
        screen: ports.screen,
      }),
      emit,
      now: log.now,
      card: (who, alone) => ports.people.cards([who], 'call', { alone }),
    });
  } catch (error) {
    return abandon('voice', error);
  }
  session = voice;
  // Told to leave before there was a voice: `finish` has given the seat back.
  if (finished) {
    await voice.close().catch(ignore);
    return over.promise;
  }

  try {
    // One attempt per process (a Room isn't reconnectable mid-connect); the watcher rejoins fresh.
    const connected = await retry(() => connection.connect(), {
      ...roomConnect,
      clock,
      onAttempt: (attempt) => emit('join.room', { ...attempt }),
    });
    live = connected;
    room = kit.room(connected, emit, handlers);
    // Told to leave while connecting: out of the room again, and done.
    if (finished) {
      await room.leave();
      return over.promise;
    }
    room.present(connection.room);
    await voice.start(connected);
  } catch (error) {
    if (finished) return over.promise;
    return abandon('room', error);
  }
  started = true;
  if (finished) return over.promise;
  if (placed !== undefined) open();
  else
    void voice
      .say(uninvited ? uninvitedGreeting(ports.name) : greeting(ports.name))
      .catch(ignore);
  await warm;
  return over.promise;
};
