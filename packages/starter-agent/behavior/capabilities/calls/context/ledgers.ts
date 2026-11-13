/**
 * The real ports of placing calls, asks, the two judgments and the ledgers
 * they keep: the one place this part of calls touches the disk's lock, the
 * network, and the `claude` program.
 */
import { dlopen, FFIType } from 'bun:ffi';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { jsonLine, parseLines } from '../../../context/disk.ts';
import type { Base } from '../../../context/index.ts';
import type { Shell } from '../../../context/shell.ts';
import type { Work } from '../../../contracts.ts';
import { readIdentity } from '../../identity/index.ts';
import {
  type AskInput,
  type AskOutcome,
  askToJoin,
  callTopic,
  type Weigh,
  weigh,
} from '../asks.ts';
import { after, callsPaths } from '../config.ts';
import {
  type AskModel,
  type Candidate,
  Decision,
  decisionLine,
  gatherCandidate,
  gatherMs,
  type JudgeContext,
  type Judgments,
  judgeMs,
  judgeWithClaude,
  judgments,
  maxWork,
  type Verdict,
} from '../judge.ts';
import {
  hungUpKept,
  type IdList,
  idList,
  type Ledger,
  ledger,
} from '../ledger.ts';
import type { CallApi } from '../macro.ts';
import {
  type Held,
  lockWaitMs,
  macroPlaceFacts,
  placeCall,
  placedFor,
  type Tell,
  tellNoAnswer,
} from '../place.ts';
import {
  AskRow,
  type NewAskRow,
  type NewPlaceRow,
  type Placed,
  type PlaceInput,
  type PlaceOutcome,
  PlaceRow,
} from '../types.ts';

/** The stream of `base.log` this part writes its decisions to. */
export const logStream = 'calls';

const claude = 'claude';
const lockPollMs = 100;
// flock(2)'s operations.
const exclusive = 2;
const nonBlocking = 4;
const unlock = 8;
const libc = process.platform === 'darwin' ? 'libc.dylib' : 'libc.so.6';

type Flock = (descriptor: number, operation: number) => number;
let loaded: Flock | undefined;
const flock: Flock = (descriptor, operation) => {
  loaded ??= dlopen(libc, {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols.flock;
  return loaded(descriptor, operation);
};

/**
 * An exclusive flock(2) on a file, waited for up to `waitMs`; null if it is
 * still busy then. The kernel drops it when the process dies, so a run that
 * crashes mid-decision can't block the next one.
 */
const fileLock =
  ({
    file,
    waitMs,
    clock,
  }: {
    readonly file: string;
    readonly waitMs: number;
    readonly clock: Clock;
  }) =>
  async (): Promise<Held | null> => {
    mkdirSync(dirname(file), { recursive: true });
    const descriptor = openSync(file, 'w');
    const deadline = after(clock.now(), waitMs);
    while (flock(descriptor, exclusive | nonBlocking) !== 0) {
      if (Temporal.Instant.compare(clock.now(), deadline) >= 0) {
        closeSync(descriptor);
        return null;
      }
      await clock.sleep(lockPollMs);
    }
    return {
      // Unlocked before it is closed: a child started meanwhile inherits the descriptor, and would hold the lock until it exits.
      release: () => {
        flock(descriptor, unlock);
        closeSync(descriptor);
      },
    };
  };

/**
 * One `claude -p` call from a temporary directory: no project, so no hooks,
 * no CLAUDE.md and no repo, and no tools. `LD_LIBRARY_PATH` is removed
 * because the flake's (for LiveKit's native audio) breaks other programs.
 */
const askClaude =
  (shell: Pick<Shell, 'run'>): AskModel =>
  async (prompt, model, timeoutMs = judgeMs) => {
    const ran = await shell.run(
      [
        claude,
        '-p',
        '--model',
        model,
        '--setting-sources',
        '',
        '--tools',
        '',
        '--output-format',
        'text',
      ],
      {
        cwd: tmpdir(),
        stdin: prompt,
        env: { LD_LIBRARY_PATH: undefined },
        timeoutMs,
      }
    );
    if (ran.code !== 0) throw new Error(`${claude} exited ${ran.code}`);
    return ran.stdout;
  };

/** What this part needs from the rest of the agent: Macro's calls, work in flight, and a way to post (chat's). */
export type LedgerNeeds = Tell & {
  readonly api: CallApi;
  readonly work: Pick<Work, 'inFlight'>;
};

export type LedgerPorts = {
  /** Every call the agent was asked to place, and what became of it. */
  readonly outbound: Ledger<PlaceRow, NewPlaceRow>;
  /** Every ask to come onto a live call, and what became of it. */
  readonly asks: Ledger<AskRow, NewAskRow>;
  /** People who said not to be called. */
  readonly noCall: IdList;
  /** Calls the agent was told to leave, or left uninvited: never rejoined. */
  readonly hungUp: IdList;
  /** Decide, record, queue: the watcher rings on its next tick. */
  readonly place: (input: PlaceInput) => Promise<PlaceOutcome>;
  /** Record an ask to come onto a live call. */
  readonly ask: (input: AskInput) => Promise<AskOutcome>;
  /** The switch judgment: one model call. */
  readonly weigh: Weigh;
  /** The join judgment on one call, as the model makes it. */
  readonly judge: (
    candidate: Candidate,
    context: JudgeContext
  ) => Promise<Verdict>;
  /** The join judgments of every live call nobody rang the agent for. The watcher drives `tick` and reads `verdicts`. */
  readonly judgments: Judgments;
  /** What's been said on a call so far, from its event log. */
  readonly callTopic: (callId: string) => Promise<string>;
  /** The agent rang and nobody came: tells them why, and whoever asked. */
  readonly tellNoAnswer: (placed: Placed) => Promise<void>;
  /** The request a placed call's seat (`place-<id>`) stands for, or null once it's finished. */
  readonly readPlaced: (callId: string) => Promise<Placed | null>;
};

export const ledgerPorts = (
  base: Base,
  { api, work, send, dm }: LedgerNeeds
): LedgerPorts => {
  const { disk, clock, shell, config, log } = base;
  const paths = callsPaths(base);
  const outbound = ledger<PlaceRow, NewPlaceRow>({
    file: paths.outbound,
    schema: PlaceRow,
    disk,
    clock,
  });
  const asks = ledger<AskRow, NewAskRow>({
    file: paths.asks,
    schema: AskRow,
    disk,
    clock,
  });
  const noCall = idList({ file: paths.noCall, disk });
  const hungUp = idList({ file: paths.hungUp, disk, keep: hungUpKept });
  const suffix = () => crypto.randomUUID().slice(0, 4);
  const askModel = askClaude(shell);
  const facts = macroPlaceFacts(api);
  const lock = fileLock({
    file: paths.outboundLock,
    waitMs: lockWaitMs,
    clock,
  });

  const judge = (candidate: Candidate, context: JudgeContext) =>
    judgeWithClaude(candidate, context, askModel);

  const late = async (): Promise<never> => {
    await clock.sleep(gatherMs);
    throw new Error('gather timed out');
  };

  return {
    outbound,
    asks,
    noCall,
    hungUp,
    place: (input) =>
      placeCall(input, {
        ...facts,
        owner: config.owner,
        rows: outbound,
        noCall,
        lock,
        clock,
        suffix,
      }),
    ask: (input) =>
      askToJoin(input, {
        me: api.me,
        message: api.message,
        liveCall: api.liveCall,
        rows: asks,
        clock,
        suffix,
      }),
    weigh: weigh(askModel),
    judge,
    judgments: judgments({
      gather: async (call) =>
        Promise.race([
          gatherCandidate(call, { api, me: await api.me(), now: clock.now() }),
          late(),
        ]),
      judge: async (candidate) =>
        judge(candidate, {
          about: [
            (await readIdentity(base).catch(() => undefined)) ?? '',
            (await disk.read(config.charter)) ?? '',
          ].join('\n\n'),
          work: (await work.inFlight()).slice(0, maxWork),
        }),
      load: async (callId) =>
        parseLines(Decision, await disk.read(paths.decisions(callId))).at(-1),
      record: async (decision) => {
        await disk.append(paths.decisions(decision.callId), jsonLine(decision));
        const { at: _, ...rest } = decision;
        await log.event(logStream, {
          event: 'decided',
          line: decisionLine(decision),
          ...rest,
        });
      },
      clock,
      failed: (callId, error) =>
        void log.event(logStream, {
          event: 'decision failed',
          callId,
          error: String(error),
        }),
    }),
    callTopic: callTopic({
      disk,
      events: paths.events,
      name: config.identity.name,
    }),
    tellNoAnswer: (placed) => tellNoAnswer({ send, dm }, clock, placed),
    readPlaced: async (callId) => placedFor(await outbound.read(), callId),
  };
};
