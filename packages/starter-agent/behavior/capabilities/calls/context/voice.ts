/**
 * The real ports of one call: the process, the disk worker, the Agent SDK,
 * and LiveKit. The area's context calls `voicePorts` once, and the
 * `joinCall` and `replayCall` capabilities use what it returns as
 * `context.voice`.
 *
 * Nothing here loads LiveKit until a call needs it: `livekit()` imports
 * `voiceLive.ts` on first use, so `bin/agent list` and the agent's own
 * process never load its native libraries.
 */
import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Telemetry } from '@macro-inc/observability/core';
import { guards } from '../../../agent/guards/index.ts';
import { claude } from '../../../context/children.ts';
import type { Base } from '../../../context/index.ts';
import type { Work } from '../../../contracts.ts';
import { settings } from '../../heartbeat/config.ts';
import { gitCommand } from '../../heartbeat/repository.ts';
import { readIdentity } from '../../identity/index.ts';
import {
  type Brain,
  type BrainNeeds,
  brainEnvironment,
  briefing,
  claudeBrain,
} from '../brain.ts';
import {
  type CallsPaths,
  callsPaths,
  joinCapability,
  voiceFile,
} from '../config.ts';
import { eventLog, trackRecorder } from '../events.ts';
import type { CallPeople, JoinPorts, Outbound } from '../join.ts';
import type { IdList } from '../ledger.ts';
import type { CallApi } from '../macro.ts';
import { callScreen } from '../session.ts';
import type { MakeShare, Placed, PlaceInput, PlaceOutcome } from '../types.ts';
import { currentVoiceFile, voiceFetchMs } from '../voice-file.ts';
import { parseVoice } from '../voices.ts';
import type { WorkingTime } from '../working.ts';
import { callDisk } from './disk.ts';
import type { Live } from './voiceLive.ts';

/** What one call takes from the other parts of calls, and from the areas around it. */
export type VoiceNeeds = {
  readonly api: CallApi;
  /** The outbound ledger: the call being placed, and what became of it. */
  readonly outbound: Outbound;
  /** A DM to who the agent rang, and to whoever asked, when nobody picked up. */
  readonly tellNoAnswer: (placed: Placed) => Promise<void>;
  /** What a placed call opens with, from its reason. */
  readonly openingLine: (reason: string) => string;
  /** Calls the agent was told to leave. */
  readonly hungUp: IdList;
  /** Placing a call: the arbiter decides, and allowed means queued. */
  readonly place: (input: PlaceInput) => Promise<PlaceOutcome>;
  /** The share part's tools for one call. Without it, the brain has no screen. */
  readonly makeShare?: MakeShare;
  readonly work: Work;
  readonly people: CallPeople;
};

export type Voice = {
  /** Everything `joinCall` runs over. */
  readonly join: JoinPorts;
  /** Ends this process with a join's code. The disk worker finishes what it can on the way out. */
  readonly exit: (code: number) => void;
  /** Whether this process was started to be one call: `bin/agent joinCall`. */
  readonly ownProcess: () => boolean;
  /** A call's brain. */
  readonly brain: (needs: BrainNeeds) => Brain;
  /** LiveKit, loaded on first use: sessions, voices, the room observer. */
  readonly livekit: () => Promise<Live>;
  /** A call's event log and a recorder on it, on the process's disk worker. */
  readonly log: JoinPorts['log'];
  readonly recorder: JoinPorts['recorder'];
  readonly paths: CallsPaths;
  /** Monotonic milliseconds. */
  readonly monotonic: () => number;
  /** A file's bytes, e.g. a recording to replay. */
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  /** A line on stdout. */
  readonly print: (line: string) => void;
};

const programsDirectory = 'bin';
const agentFile = 'agent';
/** The people area's capability that reads a finished call. */
const appraiseCapability = 'appraiseCall';
/** `bin/agent` reads its input from stdin only when told to. */
const stdinArgument = '-';

export const voicePorts = (base: Base, needs: VoiceNeeds): Voice => {
  const { config, state, disk, shell, clock, join } = base;
  const paths = callsPaths({ state, join });
  const agentProgram = join(config.root, programsDirectory, agentFile);
  const monotonic = () => performance.now();
  const print = (line: string) => console.log(line);
  const time: WorkingTime = {
    now: monotonic,
    sleep: clock.sleep,
    wall: () => clock.now().epochMilliseconds,
  };

  let loading: Promise<Live> | undefined;
  const livekit = () => {
    loading ??= (async () => {
      // rtc-node logs debug lines to stdout otherwise, ahead of the line the watcher reads.
      process.env.NODE_ENV ??= 'production';
      const { live } = await import('./voiceLive.ts');
      return live({
        relay: await base.relay(),
        voice: parseVoice(
          await currentVoiceFile({
            git: async (args) =>
              shell.run(gitCommand(settings.git, config.root, args), {
                env: await base.environment(),
                timeoutMs: voiceFetchMs,
              }),
            readLocal: () => disk.read(join(config.root, voiceFile)),
          })
        ),
        name: config.identity.name,
        time,
      });
    })();
    return loading;
  };

  const brain = (brainNeeds: BrainNeeds) =>
    claudeBrain(
      {
        query,
        claude,
        config,
        charter: () => disk.read(config.charter).catch(() => undefined),
        identity: () => readIdentity(base).catch(() => undefined),
        briefing: () => briefing({ disk, shell, config, state, join }),
        environment: async () =>
          brainEnvironment(process.env, {
            ...(await base.relayed()),
            ...(await base.environment()),
          }),
        guards,
        work: needs.work,
        place: needs.place,
        postChat: needs.api.postChat,
        elapsed: monotonic,
      },
      brainNeeds
    );

  const log: Voice['log'] = ({ file, elapsed, echo }) =>
    eventLog({
      file,
      disk: file === undefined ? undefined : callDisk(),
      elapsed,
      echo,
    });
  const recorder: Voice['recorder'] = ({ path, rate, log: onto, who }) =>
    trackRecorder({
      path,
      rate,
      log: onto,
      disk: onto.disk ?? callDisk(),
      who,
    });

  return {
    join: {
      name: config.identity.name,
      trace: base.trace,
      api: needs.api,
      // Calls hear and speak through the relay: the join fails at once without it, before any token request.
      secrets: async () => {
        await base.relay();
        await base.macro();
      },
      outbound: needs.outbound,
      tellNoAnswer: needs.tellNoAnswer,
      openingLine: needs.openingLine,
      hungUp: needs.hungUp,
      makeShare: needs.makeShare,
      people: needs.people,
      screen: async (input) =>
        (
          await (
            await base.macro()
          ).ai.decide({
            input,
            questions: {
              [callScreen.key]: callScreen.question(config.identity.name),
            },
          })
        ).probabilities[callScreen.key] ?? 0,
      // Its own process, detached, so it outlives the join. The events go in on stdin.
      appraise: (call) => {
        shell.start([agentProgram, appraiseCapability, stdinArgument], {
          cwd: config.root,
          stdin: JSON.stringify(call),
          detached: true,
        });
      },
      clock,
      monotonic,
      paths,
      // Whole-file writes here are `writeFile` from node:fs/promises, which
      // waits off the thread: `Bun.write` held a call's thread 15.5 s on a stalled ZFS.
      disk,
      proc: {
        pid: process.pid,
        print,
        complain: (line) => console.error(line),
        onSignal: (signal, handle) => {
          process.on(signal, handle);
        },
      },
      log,
      recorder,
      brain,
      livekit,
    },
    // Its spans go out before it does.
    exit: (code) => void Telemetry.flush().finally(() => process.exit(code)),
    ownProcess: () => process.argv.includes(joinCapability),
    brain,
    livekit,
    log,
    recorder,
    paths,
    monotonic,
    readBytes: async (path) => new Uint8Array(await readFile(path)),
    print,
  };
};
