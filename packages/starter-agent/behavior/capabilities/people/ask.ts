/**
 * One question to a model, through the Claude Agent SDK: no tools, no
 * settings, no project and no saved session, so it can read what people
 * wrote and do nothing but answer. It runs Claude Code the way a wake does
 * (`agent/claude.ts`): the computer's `claude`, the brain's environment (how
 * it reaches Anthropic), under the sandbox, and its cost goes on the same
 * daily ledger.
 */
import { tmpdir } from 'node:os';
import type { agentClaude, Query } from '../../agent/claude.ts';
import type { Ask } from './appraise.ts';
import { askTimeoutMs } from './config.ts';

/** The ledger's name for what an appraisal spent. */
const spendEvent = 'people.ask';

/** How the area runs Claude Code: what the agent's own wakes run it with. */
export type PeopleClaude = {
  /** The `claude` on PATH (`context/children.ts`). */
  readonly executable: () => string;
  /** The brain's environment, gateway access included. */
  readonly environment: () => Promise<
    Readonly<Record<string, string | undefined>>
  >;
  readonly sandbox: NonNullable<Parameters<typeof agentClaude>[0]['sandbox']>;
  /** Records a finished run on the daily ledger (`agent/budget.ts` `recordSpend`). */
  readonly spend: (entry: object) => Promise<void>;
};

const defined = (
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]]
    )
  );

export const sdkAsk =
  ({
    query,
    defaultModel,
    claude,
  }: {
    readonly query: Query;
    readonly defaultModel: string;
    readonly claude: PeopleClaude;
  }): Ask =>
  async (prompt, { model, system, timeoutMs } = {}) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs ?? askTimeoutMs);
    const { argv, spawn } = claude.sandbox;
    try {
      for await (const message of query({
        prompt,
        options: {
          model: model ?? defaultModel,
          cwd: tmpdir(),
          tools: [],
          settingSources: [],
          persistSession: false,
          abortController: abort,
          env: defined(await claude.environment()),
          pathToClaudeCodeExecutable: claude.executable(),
          ...(argv.length === 0
            ? {}
            : {
                spawnClaudeCodeProcess: ({ command, args, ...options }) =>
                  spawn([...argv, command, ...args], options),
              }),
          ...(system === undefined ? {} : { systemPrompt: system }),
        },
      })) {
        if (message.type !== 'result') continue;
        await claude.spend({
          event: spendEvent,
          cost_usd: message.total_cost_usd,
          session_id: message.session_id,
        });
        if (message.subtype === 'success') return message.result;
        throw new Error(`the model call ended with ${message.subtype}`);
      }
      throw new Error('the model call ended without an answer');
    } finally {
      clearTimeout(timer);
    }
  };
