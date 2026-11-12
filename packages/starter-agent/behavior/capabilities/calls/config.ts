/**
 * Where calls keep things, and the settings that aren't decisions. Every
 * rule about what the agent does with a call is in `arbiter.ts`; this file
 * only names places and credentials.
 */
import type { State } from '../../context/state.ts';

/** The owner of calls' state directories. */
export const owner = 'calls';

/** The agent's voice, in its repository: `{ "model": "aura-2-<voice>-<language>" }`, which Macro's agent settings write. */
export const voiceFile = 'config/voice.json';

/** A placed call is seated under this prefix and its ledger id, because its call id doesn't exist until it rings. */
export const placePrefix = 'place-';

/** The capability a call's process runs: `bin/agent joinCall '<json>'`. */
export const joinCapability = 'joinCall';

const eventsFile = 'events.jsonl';
const decisionsFile = 'decisions.jsonl';
const toldFile = 'told';
const pidFile = 'pid';
const joinLogFile = 'join.log';
const joinErrorsFile = 'join.err';
const arbiterFile = 'arbiter.jsonl';
const leaveDirectory = 'leave';
const channelsFile = 'channels.json';
const hungUpFile = 'hungup.json';
const outboundFile = 'outbound.jsonl';
const outboundLockFile = 'outbound.lock';
const asksFile = 'asks.jsonl';
const noCallFile = 'no-call.json';

/** Every file and directory calls use, by name. Nothing else in the area builds a path. */
export type CallsPaths = {
  /** Where each call's directory is: `<id>/`, with its events and a WAV per voice. */
  readonly calls: string;
  readonly call: (id: string) => string;
  /** A call's flight recorder: every event, ms since the join started. */
  readonly events: (id: string) => string;
  /** The join judgment's decisions about a call nobody rang the agent for. */
  readonly decisions: (id: string) => string;
  /** Present once the call's caller has been told the agent is busy, so a restart doesn't tell them twice. */
  readonly told: (id: string) => string;
  readonly pid: (id: string) => string;
  readonly joinLog: (id: string) => string;
  readonly joinErrors: (id: string) => string;
  /** One participant's recording in a call's directory. */
  readonly recording: (id: string, who: string) => string;
  /** Every decision the arbiter made, with its reason. */
  readonly arbiter: string;
  /** The line the watcher wants said before the join with this pid leaves. The join removes it once it's been heard. */
  readonly leave: (pid: number) => string;
  /** Channels whose calls the agent always joins. */
  readonly channels: string;
  /** Calls the agent was told to leave, or left uninvited: never rejoined. */
  readonly hungUp: string;
  /** Every call the agent was asked to place, and what became of it: the queue, the audit log, and what the limits count. */
  readonly outbound: string;
  readonly outboundLock: string;
  /** Every ask to come onto a live call, and what became of it. */
  readonly asks: string;
  /** People who said not to be called. */
  readonly noCall: string;
};

/** A participant's identity as a file name. */
export const fileName = (who: string): string =>
  who.replace(/[^\w.@-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';

const recordingExtension = '.wav';

export const callsPaths = ({
  state,
  join,
}: {
  readonly state: State;
  readonly join: (...parts: readonly string[]) => string;
}): CallsPaths => {
  const log = state.log(owner);
  const memory = state.memory(owner);
  const run = state.run(owner);
  const call = (id: string) => join(log, id);
  return {
    calls: log,
    call,
    events: (id) => join(call(id), eventsFile),
    decisions: (id) => join(call(id), decisionsFile),
    told: (id) => join(call(id), toldFile),
    pid: (id) => join(call(id), pidFile),
    joinLog: (id) => join(call(id), joinLogFile),
    joinErrors: (id) => join(call(id), joinErrorsFile),
    recording: (id, who) =>
      join(call(id), `${fileName(who)}${recordingExtension}`),
    arbiter: join(log, arbiterFile),
    leave: (pid) => join(run, leaveDirectory, String(pid)),
    channels: join(memory, channelsFile),
    hungUp: join(memory, hungUpFile),
    outbound: join(memory, outboundFile),
    outboundLock: join(run, outboundLockFile),
    asks: join(memory, asksFile),
    noCall: join(memory, noCallFile),
  };
};

/** Milliseconds from `then` to `now`. */
export const elapsed = (
  now: Temporal.Instant,
  then: Temporal.Instant
): number => now.since(then).total('milliseconds');

/** `at` moved by a number of milliseconds. */
export const after = (
  at: Temporal.Instant,
  milliseconds: number
): Temporal.Instant => at.add({ milliseconds: Math.round(milliseconds) });
