/**
 * What the identity area adds to the agent's context: the greeting a new agent
 * sends its owner, wired to the agent's ports. The greeting itself is
 * muppet's (`utilities/greeting`); the words come from `greeting.md` here.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Catalog } from '@macro-inc/muppet/core/capability';
import {
  type Around,
  type FailureKind,
  type Failures,
  type Greeted,
  type Greeter,
  unsayable,
} from '@macro-inc/muppet/utilities/greeting';
import { isoText } from '@macro-inc/muppet/utilities/time';
import type { TraceContext } from '@macro-inc/observability/core';
import { z } from 'zod';
import type { Trace } from '../../agent/claude.ts';
import type { Base } from '../../context/index.ts';
import { trace } from '../../context/telemetry.ts';
import type { Chat } from '../chat/macro.ts';
import type { Typing } from '../chat/typing.ts';
import type { Ask } from '../people/appraise.ts';
import { type PeopleClaude, sdkAsk } from '../people/ask.ts';
import type { Vault } from '../secrets/vault.ts';
import {
  computer,
  failuresFile,
  greetedFile,
  greetingModel,
  greetingPath,
  greetingSpend,
  greetingTimeoutMs,
} from './config.ts';
import { type Needs, owner, readIdentity } from './index.ts';
import { type GreetingMacro, sdkGreetingMacro } from './macro.ts';

export type GreeterPorts = {
  readonly context: Needs & {
    readonly disk: Pick<Base['disk'], 'read' | 'write' | 'exists'>;
    readonly clock: Base['clock'];
    readonly state: Pick<Base['state'], 'memory' | 'run'>;
  };
  readonly catalog: Catalog;
  /** Whether the agent runs on a computer of its own. */
  readonly hosted: boolean;
  readonly ask: Ask;
  readonly macro: GreetingMacro;
  readonly chat: Pick<Chat, 'send'>;
  readonly typing: Pick<Typing, 'start'>;
  /** Whether the team's vault is on for the agent. */
  readonly vaultOn: () => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  /** Calls `run` after `ms`, unless cancelled: an attempt's deadline. */
  readonly after: (ms: number, run: () => void) => () => void;
  readonly trace: Trace;
  readonly sinceStartMs: () => number;
};

/** The vault capability's name, which the greeting mentions only when the vault answers. */
const vaultCapability = 'secrets';
/**
 * How this agent runs, never shown to its owner: the command a shell calls
 * it with, and Macro's own code-mode tools, which it may be given too.
 */
const ownMachinery = [
  'bin/agent',
  'ExecuteCode',
  'DescribeCodeTools',
  'ReadCodeDocs',
];
/** How long the vault may take to say whether it is on: the owner is waiting on the hello. */
const vaultProbeMs = 2_500;
const greetingLog = 'greeting';
const noFailures: Failures = { paid: 0, unpaid: 0 };
/** The failures file, as written: data from an earlier run of this code. */
const FailuresFile = z.object({
  paid: z.number().int().nonnegative(),
  unpaid: z.number().int().nonnegative(),
});

/** The greeting, wired to the agent's ports: posted in its owner's DM once in its life. */
export const greeterOf = ({
  context,
  catalog,
  hosted,
  ask,
  macro,
  chat,
  typing,
  vaultOn,
  sleep,
  after,
  trace,
  sinceStartMs,
}: GreeterPorts): Greeter => {
  const marker = context.join(context.state.memory(owner), greetedFile);
  const failures = context.join(context.state.run(owner), failuresFile);
  const promptFile = greetingPath(context.join);
  const failed = async (): Promise<Failures> => {
    const text = await context.disk.read(failures);
    if (text === undefined) return noFailures;
    const parsed = FailuresFile.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new Error(`greeting failures file ${failures} is malformed`);
    return parsed.data;
  };

  return {
    prompt: async () => {
      const text = await context.disk.read(promptFile);
      if (text === undefined)
        throw new Error(`no greeting prompt at ${promptFile}`);
      return text;
    },
    // The vault capability is always listed, but the vault is on only for
    // some teams: it is mentioned only once it answers.
    have: async () => [
      ...Object.keys(catalog).filter((name) => name !== vaultCapability),
      ...((await vaultOn()) ? [vaultCapability] : []),
      ...(hosted ? [computer] : []),
    ],
    unsayable: unsayable(catalog, ownMachinery),
    // Claude Code started when asked: nothing to warm up, so nothing to drop.
    model: () => ({
      answer: (prompt) =>
        ask(prompt, {
          model: greetingModel,
          timeoutMs: greetingTimeoutMs,
          // Thinking costs the owner most of the wait, for a few short lines.
          thinking: false,
        }),
      cancel: () => {},
    }),
    ownerName: macro.ownerName,
    ownerDm: macro.ownerDm,
    hasMessages: macro.hasMessages,
    send: chat.send,
    startTyping: (channelId) => typing.start(channelId),
    identity: () => readIdentity(context),
    greeted: () => context.disk.exists(marker),
    markGreeted: () =>
      context.disk.write(marker, `${isoText(context.clock.now())}\n`),
    failures: failed,
    sleep,
    after,
    recordFailure: async (kind: FailureKind) => {
      const now = await failed();
      await context.disk.write(
        failures,
        `${JSON.stringify({ ...now, [kind]: now[kind] + 1 })}\n`
      );
    },
    trace,
    sinceStartMs,
  };
};

/**
 * Whether the team's vault is on for the agent: one search of one item. The
 * vault answers not_found when it is off for the team, and a vault that
 * can't be reached isn't promised to the owner either.
 */
export const vaultAnswers = async (
  vault: Pick<Vault, 'team' | 'search'>,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> => {
  const probe = async (): Promise<boolean> => {
    try {
      const answer = await vault.search(await vault.team(), {
        query: '',
        limit: 1,
      });
      return answer.kind === 'ok';
    } catch {
      return false;
    }
  };
  // A vault that is slow (busy, retrying) holds the hello no longer than this.
  return Promise.race([probe(), sleep(vaultProbeMs).then(() => false)]);
};

/**
 * Where the greeting's span goes: under the agent's start span when the
 * process that runs the agent sets it (`set`, before the behavior runs), so
 * setup and the first hello are one trace; its own trace otherwise.
 */
export const greetingParent = (): {
  readonly set: (parent: TraceContext) => void;
  readonly around: Around;
} => {
  let parent: TraceContext | undefined;
  return {
    set: (given) => {
      parent = given;
    },
    around: (run) => (parent === undefined ? run() : parent.run(run)),
  };
};

/**
 * The identity area's context. The owner is the configured one, not freshly
 * decided: a greeting only ever comes on a new agent's first start, whose
 * owner is the person who just added it, and deciding again here would race
 * the first wake's own decision.
 */
export const identityContext = (
  base: Base,
  {
    chat,
    typing,
    claude,
    hosted,
    vault,
  }: {
    readonly chat: Pick<Chat, 'send'>;
    readonly typing: Pick<Typing, 'start'>;
    /** How it runs Claude Code: as the agent's wakes do. */
    readonly claude: PeopleClaude;
    readonly hosted: boolean;
    readonly vault: Pick<Vault, 'team' | 'search'>;
  }
) =>
  behavior<Base>().decorate({
    greetingParent: greetingParent(),
    /** How a greeting ended, in the identity log: the trace has the detail. */
    greetingDone: async (greeted: Greeted): Promise<void> => {
      await base.log.event(greetingLog, {
        outcome: greeted.kind,
        ...(greeted.kind === 'posted'
          ? { channel: greeted.channelId, message: greeted.messageId }
          : {}),
      });
    },
    greeterOf: (catalog: Catalog): Greeter =>
      greeterOf({
        context: base,
        catalog,
        hosted,
        ask: sdkAsk({
          query,
          defaultModel: greetingModel,
          claude,
          spendEvent: greetingSpend,
        }),
        macro: sdkGreetingMacro(base.macro, () => base.config.owner),
        chat,
        typing,
        vaultOn: () => vaultAnswers(vault, (ms) => base.clock.sleep(ms)),
        sleep: (ms) => base.clock.sleep(ms),
        after: (ms, run) => {
          const timer = setTimeout(run, ms);
          return () => clearTimeout(timer);
        },
        trace,
        sinceStartMs: () => process.uptime() * 1000,
      }),
  });

export type IdentityContext = ContextOf<ReturnType<typeof identityContext>>;
