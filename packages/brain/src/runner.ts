// A turn is one agent run. `Runner.start` returns a handle to watch it,
// add messages while it runs, stop it, and await its outcome.
// `AgentSdkRunner` runs the Claude Agent SDK in-process with streaming input:
// each `inject` is another user message in the same session, and the input
// closes once every message has its result.
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { match } from 'ts-pattern';
import { AsyncQueue } from './channel.ts';
import type { CodeModeConnection } from './code-mode.ts';
import { startSpan, traceHeaders } from './telemetry.ts';
export type Tier = string;
export type BrainTool = NonNullable<
  Parameters<typeof createSdkMcpServer>[0]['tools']
>[number];
export type TurnRequest = Omit<Turn, 'maxBudgetUsd'> & {
  maxBudgetUsd?: number;
};
export type Turn = {
  id: string;
  tier: Tier;
  /** Execution bounds, starting when the SDK run is admitted. */
  timeout?: { wallClockMs: number; inactivityMs: number };
  /** Conversation lane, an opaque channel/thread key. */
  lane?: string;
  /** The first user message. */
  prompt: string;
  /** Appended to Claude Code's system prompt (persona, charter). */
  system: string;
  cwd: string;
  model: string;
  maxBudgetUsd: number;
  /** TypeScript handlers exposed as a per-turn in-process MCP server. */
  tools?: BrainTool[];
  /** Claude built-in tools; [] disables them for a classification-only turn. */
  builtinTools?: Options['tools'];
  strictMcpConfig?: boolean;
  /** Environment for the agent's tools (talk commands reach the brain through it). */
  env: Record<string, string>;
};
export type RunEvent =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'tool';
      name: string;
    }
  | {
      kind: 'result';
      outcome: Outcome;
    };
export type OutcomeStatus = 'success' | 'error' | 'over_budget' | 'aborted';
export type Outcome = {
  status: OutcomeStatus;
  /** The run's last result text (the agent's final message). */
  result: string;
  costUsd: number;
  /** Current prompt ended without an SDK cost result; budget accounting must fail closed. */
  costIncomplete?: true;
  sessionId: string | null;
};
export type RunHandle = {
  events: AsyncIterable<RunEvent>;
  inject(message: string): void;
  abort(): void;
  done: Promise<Outcome>;
};
export interface Runner {
  start(turn: Turn): RunHandle;
}
export type QueryFunction = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<SDKMessage> & { close?(): void };
export type AgentSdkRunnerOptions = {
  query: QueryFunction;
  tools?: Options['tools'];
  /** Connect inside the brain process; never serialize transport credentials. */
  macroTools?: (signal: AbortSignal) => Promise<CodeModeConnection>;
  /** The `claude` executable the SDK drives. */
  claudeExecutable: string;
  /** Claude access through Macro's gateway; never a personal login. */
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
  /** Claude Code's config dir, so the run never reads `~/.claude`. */
  claudeConfigDir: string;
  /** Inherited environment for the subprocess (PATH, HOME). */
  baseEnv: Record<string, string>;
};
const userMessage = (text: string): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  origin: { kind: 'human' },
});
export class AgentSdkRunner implements Runner {
  readonly #options: AgentSdkRunnerOptions;
  constructor(options: AgentSdkRunnerOptions) {
    this.#options = options;
  }
  start(turn: Turn): RunHandle {
    if (
      turn.timeout &&
      Object.values(turn.timeout).some(
        (ms) => !Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647
      )
    )
      throw new Error(
        'turn timeouts must be integer milliseconds between 1 and 2147483647'
      );
    const span = startSpan('brain.turn', {
      'brain.tier': turn.tier,
      'gen_ai.request.model': turn.model,
      'turn.id': turn.id,
      ...(turn.lane ? { 'brain.lane': turn.lane } : {}),
      ...(turn.timeout
        ? {
            'brain.timeout.wall_clock_ms': turn.timeout.wallClockMs,
            'brain.timeout.inactivity_ms': turn.timeout.inactivityMs,
          }
        : {}),
    });
    const parent = trace.setSpan(context.active(), span);
    const headers = context.with(parent, traceHeaders);
    const input = new AsyncQueue<SDKUserMessage>();
    const events = new AsyncQueue<RunEvent>();
    const abortController = new AbortController();
    const pending: string[] = [];
    let busy = false;
    const send = (text: string) => {
      if (input.isClosed)
        throw new Error(
          `turn ${turn.id} has finished; it takes no more messages`
        );
      if (busy) pending.push(text);
      else {
        busy = true;
        input.push(userMessage(text));
      }
    };
    send(turn.prompt);
    let sdkMessages: ReturnType<QueryFunction> | undefined;
    const query = (tools: BrainTool[] | undefined) => {
      sdkMessages = context.with(parent, () =>
        this.#options.query({
          prompt: input,
          options: {
            tools: turn.builtinTools ?? this.#options.tools,
            strictMcpConfig: turn.strictMcpConfig,
            mcpServers: tools?.length
              ? {
                  brain: createSdkMcpServer({
                    name: 'brain',
                    tools,
                  }),
                }
              : undefined,
            cwd: turn.cwd,
            model: turn.model,
            maxBudgetUsd: turn.maxBudgetUsd,
            abortController,
            pathToClaudeCodeExecutable: this.#options.claudeExecutable,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            settingSources: ['project'],
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: turn.system,
            },
            env: {
              ...Object.fromEntries(
                Object.entries({
                  ...this.#options.baseEnv,
                  ...turn.env,
                }).filter(
                  ([name]) =>
                    !['MACRO_API_KEY', 'OVERRIDE_MCP_SERVICE_URL'].includes(
                      name
                    )
                )
              ),
              ANTHROPIC_BASE_URL: this.#options.anthropicBaseUrl,
              ANTHROPIC_AUTH_TOKEN: this.#options.anthropicAuthToken,
              CLAUDE_CONFIG_DIR: this.#options.claudeConfigDir,
              ...(headers.traceparent
                ? {
                    ANTHROPIC_CUSTOM_HEADERS: `traceparent: ${headers.traceparent}`,
                    BRAIN_TURN_TRACEPARENT: headers.traceparent,
                  }
                : {}),
            },
          },
        })
      );
      return sdkMessages;
    };
    let connection: CodeModeConnection | undefined;
    const connect = this.#options.macroTools;
    let messages: AsyncIterable<SDKMessage>;
    try {
      messages =
        connect && turn.tier !== 'triage'
          ? (async function* () {
              connection = await connect(abortController.signal);
              if (abortController.signal.aborted) {
                await connection.close();
                return;
              }
              yield* query([...(turn.tools ?? []), ...connection.tools]);
            })()
          : query(turn.tools);
    } catch (error) {
      input.close();
      events.close();
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw error;
    }
    const cancelled = Promise.withResolvers<void>();
    let stopReason = '';
    let stopKind: 'inactivity' | 'wall_clock' | 'cancelled' = 'cancelled';
    let wallTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string, kind: typeof stopKind = 'cancelled') => {
      if (abortController.signal.aborted) return;
      stopReason = reason;
      stopKind = kind;
      input.close();
      pending.length = 0;
      // Settle independently of an SDK iterator that fails to honor abort.
      cancelled.resolve();
      abortController.abort();
      try {
        sdkMessages?.close?.();
      } catch {
        span.setAttribute('brain.query_close_failed', true);
      }
    };
    const resetIdle = () => {
      clearTimeout(idleTimer);
      if (turn.timeout)
        idleTimer = setTimeout(
          () =>
            stop(
              `Work stopped after no SDK activity for ${turn.timeout?.inactivityMs} ms.`,
              'inactivity'
            ),
          turn.timeout.inactivityMs
        );
    };
    if (turn.timeout) {
      wallTimer = setTimeout(
        () =>
          stop(
            `Work stopped after reaching its ${turn.timeout?.wallClockMs} ms wall-clock limit.`,
            'wall_clock'
          ),
        turn.timeout.wallClockMs
      );
      resetIdle();
    }
    const done = context.with(parent, async (): Promise<Outcome> => {
      let costComplete = false;
      let outcome: Outcome = {
        status: 'error',
        result: '',
        costUsd: 0,
        sessionId: null,
      };
      try {
        const iterator = messages[Symbol.asyncIterator]();
        while (!abortController.signal.aborted) {
          const next = await Promise.race([
            iterator.next(),
            cancelled.promise.then(() => ({
              done: true as const,
              value: undefined,
            })),
          ]);
          if (next.done) break;
          const message = next.value;
          resetIdle();
          for (const event of toEvents(message)) events.push(event);
          if (message.type !== 'result') continue;
          costComplete = true;
          span.setAttribute(
            'gen_ai.usage.input_tokens',
            message.usage.input_tokens
          );
          span.setAttribute(
            'gen_ai.usage.output_tokens',
            message.usage.output_tokens
          );
          span.setAttribute('brain.cost_usd', message.total_cost_usd);
          span.setAttribute('brain.outcome', message.subtype);
          if (message.subtype !== 'success')
            span.setStatus({ code: SpanStatusCode.ERROR });
          outcome = match(message)
            .returnType<Outcome>()
            .with({ subtype: 'success' }, (success) => ({
              status: 'success',
              result: success.result,
              costUsd: success.total_cost_usd,
              sessionId: success.session_id,
            }))
            .with({ subtype: 'error_max_budget_usd' }, (failure) => ({
              status: 'over_budget',
              result: failure.subtype,
              costUsd: failure.total_cost_usd,
              sessionId: failure.session_id,
            }))
            .with(
              { subtype: 'error_during_execution' },
              { subtype: 'error_max_turns' },
              { subtype: 'error_max_structured_output_retries' },
              (failure) => ({
                status: 'error',
                result: failure.subtype,
                costUsd: failure.total_cost_usd,
                sessionId: failure.session_id,
              })
            )
            .exhaustive();
          events.push({ kind: 'result', outcome });
          // Claude may absorb messages submitted mid-turn without a separate
          // result. Keep exactly one input outstanding instead of counting them.
          const followup = pending.shift();
          if (followup !== undefined) {
            costComplete = false;
            input.push(userMessage(followup));
          } else input.close();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          outcome = { ...outcome, status: 'error', result: String(error) };
        }
      } finally {
        clearTimeout(wallTimer);
        clearTimeout(idleTimer);
        await connection?.close().catch(() => {
          span.setStatus({ code: SpanStatusCode.ERROR });
        });
        input.close();
        pending.length = 0;
        events.close();
        if (stopReason) {
          span.setAttribute('brain.stop_reason', stopKind);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.setAttribute('brain.cost_incomplete', !costComplete);
        span.setAttribute('brain.aborted', abortController.signal.aborted);
        span.end();
      }
      if (!costComplete) outcome = { ...outcome, costIncomplete: true };
      return abortController.signal.aborted
        ? {
            ...outcome,
            status: 'aborted',
            result: stopReason || outcome.result,
          }
        : outcome;
    });
    return {
      events,
      inject: send,
      abort: () => {
        stop('');
      },
      done,
    };
  }
}
function toEvents(message: SDKMessage): RunEvent[] {
  if (message.type !== 'assistant') return [];
  const found: RunEvent[] = [];
  for (const block of message.message.content) {
    if (block.type === 'text') found.push({ kind: 'text', text: block.text });
    if (block.type === 'tool_use')
      found.push({ kind: 'tool', name: block.name });
  }
  return found;
}
