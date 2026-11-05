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
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { match } from 'ts-pattern';
import { AsyncQueue } from './channel.ts';
import { startSpan, traceHeaders } from './telemetry.ts';

export type Tier = 'respond' | 'heartbeat' | 'work';

export type Turn = {
  id: string;
  tier: Tier;
  /** Conversation lane, an opaque channel/thread key. */
  lane?: string;
  /** The first user message. */
  prompt: string;
  /** Appended to Claude Code's system prompt (persona, charter). */
  system: string;
  cwd: string;
  model: string;
  maxBudgetUsd: number;
  /** Environment for the agent's tools (talk commands reach the brain through it). */
  env: Record<string, string>;
};

export type RunEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'result'; outcome: Outcome };

export type OutcomeStatus = 'success' | 'error' | 'over_budget' | 'aborted';

export type Outcome = {
  status: OutcomeStatus;
  /** The run's last result text (the agent's final message). */
  result: string;
  costUsd: number;
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
}) => AsyncIterable<SDKMessage>;

export type AgentSdkRunnerOptions = {
  query: QueryFunction;
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
  constructor(private readonly options: AgentSdkRunnerOptions) {}

  start(turn: Turn): RunHandle {
    const span = startSpan('brain.turn', {
      'brain.tier': turn.tier,
      'gen_ai.request.model': turn.model,
      'turn.id': turn.id,
      ...(turn.lane ? { 'brain.lane': turn.lane } : {}),
    });
    const parent = trace.setSpan(context.active(), span);
    const headers = context.with(parent, traceHeaders);
    const input = new AsyncQueue<SDKUserMessage>();
    const events = new AsyncQueue<RunEvent>();
    const abortController = new AbortController();
    let sent = 0;
    let answered = 0;

    const send = (text: string) => {
      if (input.isClosed)
        throw new Error(
          `turn ${turn.id} has finished; it takes no more messages`
        );
      sent++;
      input.push(userMessage(text));
    };
    send(turn.prompt);

    let messages: AsyncIterable<SDKMessage>;
    try {
      messages = context.with(parent, () =>
        this.options.query({
          prompt: input,
          options: {
            cwd: turn.cwd,
            model: turn.model,
            maxBudgetUsd: turn.maxBudgetUsd,
            abortController,
            pathToClaudeCodeExecutable: this.options.claudeExecutable,
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            settingSources: ['project'],
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: turn.system,
            },
            env: {
              ...this.options.baseEnv,
              ...turn.env,
              ANTHROPIC_BASE_URL: this.options.anthropicBaseUrl,
              ANTHROPIC_AUTH_TOKEN: this.options.anthropicAuthToken,
              CLAUDE_CONFIG_DIR: this.options.claudeConfigDir,
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
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw error;
    }

    const done = context.with(parent, async (): Promise<Outcome> => {
      let outcome: Outcome = {
        status: 'error',
        result: '',
        costUsd: 0,
        sessionId: null,
      };
      try {
        for await (const message of messages) {
          for (const event of toEvents(message)) events.push(event);
          if (message.type !== 'result') continue;

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
          answered++;
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
          if (answered >= sent) input.close();
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          outcome = { ...outcome, status: 'error', result: String(error) };
        }
      } finally {
        input.close();
        events.close();
        span.setAttribute('brain.aborted', abortController.signal.aborted);
        span.end();
      }
      return abortController.signal.aborted
        ? { ...outcome, status: 'aborted' }
        : outcome;
    });

    return {
      events,
      inject: send,
      abort: () => {
        abortController.abort();
        input.close();
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
