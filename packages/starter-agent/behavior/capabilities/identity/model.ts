/**
 * The greeting's model, two ways, both started before they are asked so the
 * owner's wait is only the model's answer:
 *
 * - In Macro-credits mode the agent's process holds the Anthropic gateway's
 *   address and token, so the greeting asks it directly: one HTTPS request,
 *   no Claude Code to start, billed by the gateway as any other call.
 * - On the customer's Claude plan the sign-in lives in harnessd's `claude`
 *   wrapper and is for Claude Code only, so Claude Code is started at once,
 *   with a prompt that streams in later: it spawns and signs in while the
 *   rest of the greeting is fetched.
 */
import { tmpdir } from 'node:os';
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { GreetingModel } from '@macro-inc/muppet/utilities/greeting';
import { z } from 'zod';
import type { PeopleClaude } from '../people/ask.ts';

/** The gateway's (or Anthropic's) Messages API, as the relay reaches it. */
export type Upstream = { readonly url: string; readonly token: string };

const messagesPath = '/v1/messages';
const apiVersion = '2023-06-01';
/** A few short lines: room to spare, never a page. */
const maxTokens = 600;
/**
 * Anthropic's list price for Haiku 4.5, per token, for the agent's own daily
 * ledger: the gateway bills the account from its own table.
 */
const usdPerInputToken = 1 / 1_000_000;
const usdPerOutputToken = 5 / 1_000_000;

const Reply = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number().nullish(),
    cache_read_input_tokens: z.number().nullish(),
  }),
});

type Spend = (entry: object) => Promise<void>;

/** As much of a session's messages as the greeting reads: the results. */
export type SessionMessage =
  | {
      readonly type: 'result';
      readonly subtype: string;
      readonly result?: string;
      readonly total_cost_usd: number;
      readonly session_id: string;
    }
  | { readonly type: Exclude<SDKMessage['type'], 'result'> };

/** The SDK's `query`, as a session whose prompt streams in later uses it. */
export type StreamingQuery = (params: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options?: Options;
}) => AsyncIterable<SessionMessage>;

/** Asks the Messages API directly: the credits mode's way. */
export const directModel = ({
  upstream,
  fetch,
  model,
  timeoutMs,
  spend,
  spendEvent,
}: {
  readonly upstream: Upstream;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly model: string;
  readonly timeoutMs: number;
  readonly spend: Spend;
  readonly spendEvent: string;
}): GreetingModel => {
  const abort = new AbortController();
  return {
    answer: async (prompt) => {
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const response = await fetch(
          new Request(`${upstream.url.replace(/\/+$/, '')}${messagesPath}`, {
            method: 'POST',
            signal: abort.signal,
            headers: {
              authorization: `Bearer ${upstream.token}`,
              'anthropic-version': apiVersion,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
            }),
          })
        );
        if (!response.ok)
          throw new Error(`the model call failed with ${response.status}`);
        const reply = Reply.parse(await response.json());
        const input =
          reply.usage.input_tokens +
          (reply.usage.cache_creation_input_tokens ?? 0) +
          (reply.usage.cache_read_input_tokens ?? 0);
        await spend({
          event: spendEvent,
          cost_usd:
            input * usdPerInputToken +
            reply.usage.output_tokens * usdPerOutputToken,
        });
        return reply.content.flatMap(({ text }) => text ?? []).join('');
      } finally {
        clearTimeout(timer);
      }
    },
    cancel: () => abort.abort(),
  };
};

/** Messages pushed in after the session has started; ends when closed. */
const inbox = () => {
  const queued: SDKUserMessage[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const messages: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queued.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  const nudge = () => {
    wake?.();
    wake = undefined;
  };
  return {
    messages,
    push: (message: SDKUserMessage) => {
      queued.push(message);
      nudge();
    },
    close: () => {
      closed = true;
      nudge();
    },
  };
};

const defined = (
  environment: Readonly<Record<string, string | undefined>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]]
    )
  );

/**
 * Claude Code started now, asked later: the Claude plan's way. No tools, no
 * settings, no saved session, no thinking, as a people appraisal runs it.
 */
export const warmClaude = ({
  query,
  claude,
  model,
  timeoutMs,
  spendEvent,
}: {
  readonly query: StreamingQuery;
  readonly claude: PeopleClaude;
  readonly model: string;
  readonly timeoutMs: number;
  readonly spendEvent: string;
}): GreetingModel => {
  const abort = new AbortController();
  const input = inbox();
  const waiting: {
    readonly resolve: (text: string) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  const { argv, spawn } = claude.sandbox;
  const session = (async () => {
    const options: Options = {
      model,
      cwd: tmpdir(),
      tools: [],
      settingSources: [],
      persistSession: false,
      abortController: abort,
      thinking: { type: 'disabled' },
      env: defined(await claude.environment()),
      pathToClaudeCodeExecutable: claude.executable(),
      ...(argv.length === 0
        ? {}
        : {
            spawnClaudeCodeProcess: ({ command, args, ...rest }) =>
              spawn([...argv, command, ...args], rest),
          }),
    };
    for await (const message of query({ prompt: input.messages, options })) {
      if (message.type !== 'result') continue;
      await claude.spend({
        event: spendEvent,
        cost_usd: message.total_cost_usd,
        session_id: message.session_id,
      });
      const next = waiting.shift();
      if (message.subtype === 'success' && message.result !== undefined)
        next?.resolve(message.result);
      else
        next?.reject(new Error(`the model call ended with ${message.subtype}`));
    }
  })();
  // A session that ends, or fails to start, fails whoever is still waiting.
  void (async () => {
    try {
      await session;
      for (const next of waiting.splice(0))
        next.reject(new Error('the model session ended'));
    } catch (error) {
      for (const next of waiting.splice(0)) next.reject(error);
    }
  })();
  return {
    answer: (prompt) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        waiting.push({
          resolve: (text) => {
            clearTimeout(timer);
            resolve(text);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        input.push({
          type: 'user',
          message: { role: 'user', content: prompt },
          parent_tool_use_id: null,
        });
      }),
    cancel: () => {
      input.close();
      abort.abort();
    },
  };
};

/**
 * The direct call when there is a gateway, warm Claude Code otherwise. The
 * choice is made as it starts, so the warm-up isn't held for it.
 */
export const eitherModel = (
  upstream: () => Promise<Upstream | undefined>,
  {
    direct,
    warm,
  }: {
    readonly direct: (upstream: Upstream) => GreetingModel;
    readonly warm: () => GreetingModel;
  }
): GreetingModel => {
  const chosen = (async () => {
    const found = await upstream();
    return found === undefined ? warm() : direct(found);
  })();
  return {
    answer: async (prompt) => (await chosen).answer(prompt),
    cancel: () => {
      void (async () => {
        try {
          (await chosen).cancel();
        } catch {
          // A model that never started has nothing to drop.
        }
      })();
    },
  };
};
