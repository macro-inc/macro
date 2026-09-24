/**
 * Debug gallery for the block-agent ui library: every pure component with
 * fixture data, plus a full `AgentMessage` rendered end-to-end. Mounted at
 * `/component/agent-ui`.
 */

import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { MagicChipView } from '@core/component/LexicalMarkdown/component/decorator/MagicChip/MagicChipView';
import type { MagicChipPresentation } from '@core/component/LexicalMarkdown/component/decorator/MagicChip/presentation';
import { MarkdownImage } from '@core/component/LexicalMarkdown/component/decorator/MarkdownImage';
import { MediaLoadingPlaceholder } from '@core/component/LexicalMarkdown/component/decorator/MediaLoadingPlaceholder';
import { useUserId } from '@core/context/user';
import FileText from '@phosphor/file-text.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Terminal from '@phosphor/terminal.svg';
import type {
  ElicitationSchema,
  FoldedMessage,
  MessagePart,
  ModelOption,
  PendingElicitation,
  ToolStatus,
} from '@service-agent-fold/generated/types';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Message } from '../component/AgentMessage';
import { ReplyToSelection } from '../component/ReplyToSelection';
import { initialValues, validate } from '../state/elicitation-form';
import {
  ActionLine,
  AgentInput,
  AgentModelSelector,
  AnimatedNumber,
  ComposerNotice,
  CountSummary,
  DiffChanges,
  ElicitationForm,
  PierreDiff,
  QuestionAnswers,
  type QuoteInsert,
  TextShimmer,
  Thought,
  TodoList,
  ToolCard,
  ToolErrorCard,
  ToolGroup,
  ToolStatusTitle,
} from '../ui';

/**
 * A Cursor-shaped catalog: long enough to scroll, with one grouped tail. Auto
 * arrives under a family of its own, as Cursor files it.
 */
const FIXTURE_MODELS: ModelOption[] = [
  { id: 'default', name: 'Auto', description: null, group: 'Auto' },
  {
    id: 'grok-4.6-high-fast',
    name: 'Cursor Grok 4.6 High Fast',
    description: null,
    group: null,
  },
  { id: 'composer-2.5', name: 'Composer 2.5', description: null, group: null },
  {
    id: 'opus-5-high',
    name: 'Claude Opus 5 High',
    description: null,
    group: null,
  },
  {
    id: 'opus-5-high-fast',
    name: 'Claude Opus 5 High Fast',
    description: null,
    group: null,
  },
  { id: 'sol-high', name: 'GPT-5.6 Sol High', description: null, group: null },
  {
    id: 'sol-high-fast',
    name: 'GPT-5.6 Sol High Fast',
    description: null,
    group: null,
  },
  {
    id: 'sol-xhigh',
    name: 'GPT-5.6 Sol Extra High',
    description: null,
    group: null,
  },
  {
    id: 'fable-5-high',
    name: 'Claude Fable 5 High',
    description: null,
    group: null,
  },
  {
    id: 'gemini-3.7-flash-high',
    name: 'Gemini 3.7 Flash High',
    description: null,
    group: null,
  },
  {
    id: 'sonnet-5-high',
    name: 'Claude Sonnet 5 High',
    description: null,
    group: null,
  },
  {
    id: 'luna-high',
    name: 'GPT-5.6 Luna High',
    description: null,
    group: 'Legacy',
  },
];

/**
 * A Macro Agent catalog: the in-memory harness keeps no display names, so
 * every option arrives named after its own slug.
 */
const FIXTURE_INMEM_MODELS: ModelOption[] = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-5.5',
  'openai/gpt-5-mini',
].map((id) => ({ id, name: id, description: null, group: null }));

/** The composer as the block mounts it, with the model control wired. */
function ModelSelectorDemo(props: {
  options: ModelOption[];
  initialModel: string;
}) {
  const [model, setModel] = createSignal<string | null>(props.initialModel);
  return (
    <AgentInput
      onSend={(content) => console.info('[gallery] send', content)}
      modelControl={
        <AgentModelSelector
          model={model()}
          options={props.options}
          onSelect={(id) => {
            console.info('[gallery] model', id);
            setModel(id);
          }}
        />
      }
    />
  );
}

function Item(props: { label: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2">
      <h2 class="text-xs font-medium uppercase tracking-wide text-ink-extra-muted">
        {props.label}
      </h2>
      <div class="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}

/**
 * Select text in the fixture message: a "Reply to this" chip should appear
 * and insert a referenced paste into the composer below.
 */
function ReplyToSelectionDemo() {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  let quoteInsert: QuoteInsert | undefined;

  return (
    <div class="flex flex-col gap-3">
      <p class="text-xs text-ink-muted">
        Select any of the message text, then click Reply to this.
      </p>
      <div ref={setContainer} class="relative">
        <Message message={FIXTURE_MESSAGE} inFlight={false} />
        <ReplyToSelection
          container={container()}
          onReply={(text) => quoteInsert?.(text)}
        />
      </div>
      <AgentInput
        placeholder="Referenced text lands here"
        onSend={(content) => console.info('[gallery] send', content)}
        registerQuoteInsert={(insert) => {
          quoteInsert = insert;
        }}
      />
    </div>
  );
}

/** Flips every few seconds so the running→done animations stay observable. */
function usePulse(intervalMs = 2500) {
  const [on, setOn] = createSignal(true);
  const timer = setInterval(() => setOn((value) => !value), intervalMs);
  onCleanup(() => clearInterval(timer));
  return on;
}

function useCounter(intervalMs = 1200) {
  const [count, setCount] = createSignal(3);
  const timer = setInterval(
    () => setCount((value) => (value + 1) % 12),
    intervalMs
  );
  onCleanup(() => clearInterval(timer));
  return count;
}

const FIXTURE_DIFF = {
  path: 'crates/agent_fold/src/domain/fold.rs',
  oldText:
    'fn fold(log: &[Frame]) -> Vec<Message> {\n    let mut out = Vec::new();\n    for frame in log {\n        out.push(frame.into());\n    }\n    out\n}\n',
  newText:
    'fn fold(log: &[Frame]) -> Vec<Message> {\n    let mut machine = FoldMachine::default();\n    for frame in log {\n        machine.push(frame);\n    }\n    machine.finish()\n}\n',
};

const TOOL_REPLAY_PARTS: MessagePart[] = [
  {
    kind: 'tool_use',
    id: 'replay-search',
    name: { kind: 'mcp', server: 'macro', tool: 'SearchSkills' },
    status: 'completed',
    detail: {
      kind: 'macro',
      input: { name: 'launch checklist' },
      output: {
        results: [
          {
            documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e46',
            name: 'Launch checklist',
            updatedAt: null,
          },
          {
            documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e47',
            name: 'Launch timeline',
            updatedAt: null,
          },
          {
            documentId: '4a4886d8-9f4b-4f7e-a5a3-3f5c8b6c0e48',
            name: 'Release notes',
            updatedAt: null,
          },
        ],
      },
      error: null,
    },
  },
  {
    kind: 'tool_use',
    id: 'replay-read',
    name: { kind: 'native', name: 'Read' },
    status: 'completed',
    detail: { kind: 'read', paths: ['Launch checklist'] },
  },
  {
    kind: 'tool_use',
    id: 'replay-fetch',
    name: { kind: 'native', name: 'Fetch' },
    status: 'failed',
    detail: {
      kind: 'fetch',
      output: 'Could not reach status.macro.com/api: connection refused.',
    },
  },
  {
    kind: 'tool_use',
    id: 'replay-edit',
    name: { kind: 'native', name: 'Edit' },
    status: 'completed',
    detail: {
      kind: 'edit',
      diffs: [{ ...FIXTURE_DIFF, path: 'docs/launch.md' }],
    },
  },
  {
    kind: 'tool_use',
    id: 'replay-agent',
    name: { kind: 'native', name: 'Agent' },
    status: 'completed',
    detail: {
      kind: 'subagent',
      title: 'Verify changes',
      description: 'Verify the launch checklist',
      agentType: 'subagent',
      prompt: 'Verify changes to docs/launch.md',
      background: false,
      children: [],
      result: {
        text: 'The launch checklist is consistent.',
        error: null,
        agentId: 'replay-review',
        model: null,
        durationMs: 3485,
        tokens: null,
        toolUses: 1,
        stats: null,
      },
    },
  },
  {
    kind: 'tool_use',
    id: 'replay-shell',
    name: { kind: 'native', name: 'Shell' },
    status: 'completed',
    detail: {
      kind: 'terminal',
      command: 'bun run check',
      output: 'All checks passed.',
      exitCode: 0,
    },
  },
];

/** Exercises the production message renderer with both paced and batched calls. */
function ToolReplayDemo() {
  const [count, setCount] = createSignal(TOOL_REPLAY_PARTS.length);
  const [inFlight, setInFlight] = createSignal(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  const finish = () => {
    clearInterval(timer);
    timer = undefined;
    setInFlight(false);
  };
  const replay = (interval: number) => {
    finish();
    setCount(1);
    setInFlight(true);
    timer = setInterval(() => {
      if (count() === TOOL_REPLAY_PARTS.length) finish();
      else setCount((value) => value + 1);
    }, interval);
  };
  onCleanup(() => clearInterval(timer));
  const message = (): FoldedMessage => ({
    agentSessionId: 'tool-replay',
    requestId: null,
    pending: false,
    turn: 0,
    author: { kind: 'agent' },
    stop: inFlight() ? null : { kind: 'end_turn' },
    parts: TOOL_REPLAY_PARTS.slice(0, count()).map((part, index) =>
      part.kind === 'tool_use' && inFlight() && index === count() - 1
        ? { ...part, status: 'running' }
        : part
    ),
  });
  return (
    <div class="flex flex-col gap-4" data-testid="tool-replay">
      <div class="flex flex-wrap gap-3 text-xs text-ink-muted">
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1"
          onClick={() => replay(1000)}
        >
          Replay tool calls
        </button>
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1"
          onClick={() => replay(80)}
        >
          Replay fast batch
        </button>
        <button
          type="button"
          class="rounded border border-edge-muted px-2 py-1 disabled:opacity-40"
          disabled={!inFlight()}
          onClick={finish}
        >
          Finish tool calls
        </button>
      </div>
      <Message message={message()} inFlight={inFlight()} />
    </div>
  );
}

/** A generated view stays visible between collapsed runs, even before a result. */
function DisplayResultsDemo() {
  const [pending, setPending] = createSignal(false);
  const message = (): FoldedMessage => ({
    agentSessionId: 'display-results-demo',
    requestId: null,
    pending: false,
    turn: 0,
    author: { kind: 'agent' },
    stop: pending() ? null : { kind: 'end_turn' },
    parts: [
      ...TOOL_REPLAY_PARTS.slice(0, 2),
      {
        kind: 'tool_use',
        id: 'display-results-demo',
        name: { kind: 'mcp', server: 'macro', tool: 'DisplayResults' },
        status: pending() ? 'running' : 'completed',
        detail: {
          kind: 'macro',
          input: {
            view: {
              title: 'Launch overview',
              widgets: [
                {
                  type: 'md',
                  markdown:
                    'The checklist is ready. **Two steps remain before launch.**',
                },
                {
                  type: 'timeline',
                  events: [
                    {
                      time: 'Today',
                      title: 'Review launch checklist',
                      description:
                        'Confirm the release notes and rollout plan.',
                    },
                    {
                      time: 'Tomorrow',
                      title: 'Launch',
                      description: 'Publish the release after checks pass.',
                      future: true,
                    },
                  ],
                },
              ],
            },
          },
          output: null,
          error: null,
        },
      },
      ...(pending() ? [] : TOOL_REPLAY_PARTS.slice(4)),
    ],
  });
  return (
    <div class="flex flex-col gap-3" data-testid="display-results-demo">
      <label class="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={pending()}
          onChange={(event) => setPending(event.currentTarget.checked)}
        />
        DisplayResults in progress
      </label>
      <Message message={message()} inFlight={pending()} />
    </div>
  );
}

const FIXTURE_MESSAGE: FoldedMessage = {
  agentSessionId: 'demo',
  requestId: null,
  pending: false,
  turn: 0,
  author: { kind: 'agent' },
  stop: { kind: 'end_turn' },
  parts: [
    {
      kind: 'text',
      text: "I'll look at the fold implementation and tighten it up.",
    },
    {
      kind: 'thought',
      text: 'The batch fold re-derives every message per frame; the incremental machine already handles this.',
    },
    {
      kind: 'tool_use',
      id: 'demo-read',
      name: { kind: 'native', name: 'Read' },
      status: 'completed',
      detail: { kind: 'read', paths: ['crates/agent_fold/src/domain/fold.rs'] },
    },
    {
      kind: 'tool_use',
      id: 'demo-search',
      name: { kind: 'native', name: 'Search' },
      status: 'completed',
      detail: {
        kind: 'search',
        paths: ['crates/agent_fold/src'],
        output: 'fold.rs:12: fn fold(log: &[Frame]) -> Vec<Message>',
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-edit',
      name: { kind: 'native', name: 'Edit' },
      status: 'completed',
      detail: { kind: 'edit', diffs: [FIXTURE_DIFF] },
    },
    {
      kind: 'tool_use',
      id: 'demo-terminal',
      name: { kind: 'native', name: 'Bash' },
      status: 'running',
      detail: {
        kind: 'terminal',
        command: 'cargo test -p agent_fold',
        output: 'running 14 tests\n[32mtest fold::turns ... ok[0m',
        exitCode: null,
      },
    },
    {
      kind: 'permission',
      requestId: 'demo-permission-1',
      toolCall: 'demo-terminal',
      options: [
        { id: 'allow', name: 'Allow', kind: 'allow_once' },
        { id: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
      outcome: { kind: 'selected', optionId: 'allow' },
    },
    {
      kind: 'tool_use',
      id: 'demo-subagent',
      name: { kind: 'native', name: 'Agent' },
      status: 'completed',
      detail: {
        kind: 'subagent',
        title: 'Check the arithmetic',
        agentType: 'general-purpose',
        description: 'Check the arithmetic',
        prompt: 'Run `python3 -c "print(5+5)"` and report the output.',
        background: false,
        children: [
          {
            kind: 'tool_use',
            id: 'demo-subagent-bash',
            name: { kind: 'native', name: 'Bash' },
            status: 'completed',
            detail: {
              kind: 'terminal',
              command: 'python3 -c "print(5+5)"',
              output: '10',
              exitCode: 0,
            },
          },
        ],
        result: {
          text: 'Output: `10`',
          error: null,
          agentId: 'af2647314187b6bf1',
          model: 'claude-opus-5[1m]',
          durationMs: 3485,
          tokens: 26077,
          toolUses: 1,
          stats: null,
        },
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-macro',
      name: { kind: 'mcp', server: 'macro', tool: 'BrandNewTool' },
      status: 'completed',
      detail: {
        kind: 'macro',
        input: { query: 'fold' },
        output: { hits: 3 },
        error: null,
      },
    },
    // A Macro MCP call whose payload does not fit the registered renderer:
    // keep its summary visible without exposing the raw exchange.
    {
      kind: 'tool_use',
      id: 'demo-mcp-macro',
      name: { kind: 'mcp', server: 'macro', tool: 'ReadChannelThread' },
      status: 'completed',
      detail: {
        kind: 'other',
        acpKind: 'other',
        output: null,
        input: {
          channelId: '0195d2dd-5de9-71f2-9d59-5d9734f1adb7',
          threadId: '01a0b102-3e01-7166-92ca-e5a4b11dace6',
          limit: 20,
        },
        result: {
          channelName: 'feature-requests',
          messages: [
            {
              id: '01a0b16e-95d9-79a8-ace0-2dc075b7d49f',
              sender: 'macro|gab@macro.com',
              text: 'references for agents so i know where they were dispatched from',
              sentAt: '2026-09-17T22:41:03Z',
            },
            {
              id: '01a0b17a-db3f-75d1-86d9-0d8e86b5106b',
              sender: 'macro|gab@macro.com',
              text: 'would be nice to be able to scroll context/copy the entire thing',
              sentAt: '2026-09-17T22:47:19Z',
            },
          ],
          hasMore: false,
        },
        error: null,
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-mcp-deepwiki',
      name: { kind: 'mcp', server: 'deepwiki', tool: 'ask_question' },
      status: 'completed',
      detail: {
        kind: 'other',
        acpKind: 'other',
        output: null,
        input: {
          repoName: 'sst/opencode',
          question: 'How are tool calls rendered in the session UI?',
        },
        result:
          'Tool calls render through `basic-tool-v2.tsx`: one collapsible row per call, with the tool-specific body mounted on expansion.',
        error: null,
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-mcp-refused',
      name: { kind: 'mcp', server: 'ops', tool: 'deploy' },
      status: 'failed',
      detail: {
        kind: 'other',
        acpKind: 'other',
        output: null,
        input: { environment: 'production', service: 'agent-fold' },
        result: null,
        error: 'user declined',
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-email',
      name: { kind: 'mcp', server: 'macro', tool: 'SendEmail' },
      status: 'completed',
      detail: {
        kind: 'user_tool',
        input: {
          subject: 'Fold status',
          body: 'Hi Alice,\n\nThe fold now knows which harness it is reading.',
          to: [{ email: 'alice@example.com', name: 'Alice' }],
        },
        outcome: { kind: 'pending' },
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-email-sent',
      name: { kind: 'mcp', server: 'macro', tool: 'SendEmail' },
      status: 'completed',
      detail: {
        kind: 'user_tool',
        input: {
          subject: 'Re: fold status',
          body: 'Thanks Alice - shipping it.',
          to: [{ email: 'alice@example.com', name: 'Alice' }],
          cc: [{ email: 'bob@example.com' }],
        },
        outcome: {
          kind: 'sent',
          messageId: '9c4d2c6e-2f3a-4d1e-8b0a-5e6f7a8b9c0d',
          threadId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        },
      },
    },
    {
      kind: 'tool_use',
      id: 'demo-event',
      name: { kind: 'mcp', server: 'macro', tool: 'CreateCalendarEvent' },
      status: 'completed',
      detail: {
        kind: 'user_tool',
        input: {
          title: 'Fold review',
          time: {
            kind: 'timed',
            startsAt: '2026-09-04T16:00:00Z',
            endsAt: '2026-09-04T16:30:00Z',
            timeZone: 'America/New_York',
          },
          location: 'Room 4',
          attendees: [
            { email: 'alice@example.com' },
            { email: 'bob@example.com', isOptional: true },
          ],
          description: 'Walk through the harness readers.',
        },
        outcome: { kind: 'rejected' },
      },
    },
  ],
};

/** A live Cursor-shaped turn: earlier reasoning has settled, the tail has not. */
const FIXTURE_IN_FLIGHT: FoldedMessage = {
  agentSessionId: 'demo',
  requestId: null,
  pending: false,
  turn: 1,
  author: { kind: 'agent' },
  stop: null,
  parts: [
    {
      kind: 'thought',
      text: 'The batch fold re-derives every message per frame; switch to the incremental machine.',
    },
    {
      kind: 'tool_use',
      id: 'live-read',
      name: { kind: 'native', name: 'Read' },
      status: 'completed',
      detail: { kind: 'read', paths: ['crates/agent_fold/src/domain/fold.rs'] },
    },
    {
      kind: 'tool_use',
      id: 'live-search',
      name: { kind: 'native', name: 'Search' },
      status: 'completed',
      detail: {
        kind: 'search',
        paths: ['crates/agent_fold/src'],
        output: 'fold.rs:12: fn fold(log: &[Frame]) -> Vec<Message>',
      },
    },
    {
      kind: 'thought',
      text: 'The incremental machine already handles this. Next I will edit fold.rs.',
    },
  ],
};

/**
 * A turn the log never closed: `stop: null`, a call still `running`, a
 * trailing thought. The fold leaves a superseded turn exactly like this, and
 * so does a runtime that died mid-turn. Whether it reads as live is the
 * transcript's call, not the message's.
 */
const FIXTURE_UNCLOSED: FoldedMessage = {
  agentSessionId: 'demo',
  requestId: null,
  pending: false,
  turn: 2,
  author: { kind: 'agent' },
  stop: null,
  parts: [
    {
      kind: 'thought',
      text: 'The tests pin the snapshot, so the fixture has to change with the fold.',
    },
    {
      kind: 'tool_use',
      id: 'unclosed-read',
      name: { kind: 'native', name: 'Read' },
      status: 'completed',
      detail: { kind: 'read', paths: ['crates/agent_fold/src/domain/test.rs'] },
    },
    {
      kind: 'tool_use',
      id: 'unclosed-bash',
      name: { kind: 'native', name: 'Bash' },
      status: 'running',
      detail: {
        kind: 'terminal',
        command: 'cargo insta test -p agent_fold',
        output: null,
        exitCode: null,
      },
    },
    {
      kind: 'thought',
      text: 'Waiting on the snapshot run before touching the fixture.',
    },
  ],
};

/**
 * The same unclosed turn, live or settled at the flip of a switch: the
 * active ? done transition every shimmer in a message goes through when the
 * session's `working` drops, whatever the message's own `stop` says.
 */
function LiveTurnDemo() {
  const [inFlight, setInFlight] = createSignal(true);
  return (
    <div class="flex flex-col gap-3">
      <label class="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={inFlight()}
          onChange={(event) => setInFlight(event.currentTarget.checked)}
        />
        Turn in flight
      </label>
      <Message message={FIXTURE_UNCLOSED} inFlight={inFlight()} />
    </div>
  );
}

/**
 * A shared session's prompts: the viewer's own bubble stays bare, another
 * participant's carries their name.
 */
function PromptAuthorDemo() {
  const userId = useUserId();
  const prompt = (userId: string | null, text: string): FoldedMessage => ({
    agentSessionId: 'demo',
    requestId: null,
    pending: false,
    turn: 0,
    author: { kind: 'user', userId },
    stop: null,
    parts: [{ kind: 'text', text }],
  });
  return (
    <div class="flex flex-col gap-3">
      <Message
        message={prompt(userId() ?? null, 'Tighten up the fold, please.')}
        inFlight={false}
      />
      <Message
        message={prompt(
          'macro|wolf@macro.com',
          'And run the snapshot tests after.'
        )}
        inFlight={false}
      />
    </div>
  );
}

/**
 * The Claude Code colour question after the fold collapsed its custom pair,
 * plus one of every other field type, so the form's controls can be eyeballed.
 */
const FIXTURE_ELICITATION: ElicitationSchema = {
  title: 'Deployment',
  description: 'A few details before the agent continues.',
  required: ['question_0', 'name'],
  properties: [
    {
      name: 'question_0',
      title: 'Best colour',
      description: null,
      schema: {
        type: 'string',
        minLength: null,
        maxLength: null,
        pattern: null,
        format: null,
        default: null,
        options: [
          { value: 'Red', title: 'Red', description: 'Warm' },
          { value: 'Blue', title: 'Blue', description: 'Cool' },
          { value: 'Green', title: 'Green', description: null },
        ],
        customField: 'question_0_custom',
      },
    },
    {
      name: 'name',
      title: 'Service name',
      description: 'Lowercase letters only',
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 32,
        pattern: '^[a-z]+$',
        format: null,
        default: 'api',
        options: [],
        customField: null,
      },
    },
    {
      name: 'port',
      title: 'Port',
      description: null,
      schema: { type: 'integer', minimum: 1024, maximum: 65535, default: 3000 },
    },
    {
      name: 'logging',
      title: 'Enable logging',
      description: null,
      schema: { type: 'boolean', default: true },
    },
    {
      name: 'regions',
      title: 'Regions',
      description: null,
      schema: {
        type: 'multi_select',
        minItems: 1,
        maxItems: 2,
        options: [
          { value: 'us', title: 'US', description: null },
          { value: 'eu', title: 'EU', description: null },
          { value: 'ap', title: 'APAC', description: null },
        ],
        default: ['us'],
        customField: 'regions_custom',
      },
    },
    {
      name: 'weird',
      title: 'Hologram',
      description: null,
      schema: { type: 'unrecognized', typeName: '_hologram', raw: {} },
    },
  ],
};

const GALLERY_CHIP_HEADER = {
  agent: 'Cursor Agent',
  model: 'Claude Opus 5 High',
};

/** The chip through a turn: booting, writing, and done. */
function MagicChipStateDemo(props: { presentation: MagicChipPresentation }) {
  return (
    <MagicChipView
      agentSessionId="gallery"
      presentation={props.presentation}
      header={GALLERY_CHIP_HEADER}
      onOpen={() => console.log('[gallery] open session')}
    />
  );
}

/** The chip asking, one per request kind; answers land in the console. */
function MagicChipAskingDemo(props: {
  request: PendingElicitation['request'];
}) {
  const presentation: MagicChipPresentation = {
    kind: 'asking',
    markdown: 'Happy to. One quick question before I go on.',
    asking: {
      request: {
        kind: 'elicitation',
        requestId: 0,
        turn: 0,
        toolCall: null,
        message: 'Which colour, and where should it run?',
        request: props.request,
      },
      canAnswer: true,
      answering: false,
    },
  };
  return (
    <MagicChipView
      agentSessionId="gallery"
      presentation={presentation}
      header={GALLERY_CHIP_HEADER}
      answer={{
        respond: async (answer) => {
          console.log('[gallery] elicitation answer', answer);
          return true;
        },
      }}
      onOpen={() => console.log('[gallery] open session')}
    />
  );
}

function ElicitationFormDemo() {
  const [values, setValues] = createStore(initialValues(FIXTURE_ELICITATION));
  const errors = () => validate(FIXTURE_ELICITATION, values);
  return (
    <ToolCard title="Macro Coder is asking" status="running" defaultOpen>
      <ElicitationForm
        schema={FIXTURE_ELICITATION}
        values={values}
        errors={errors()}
        onChange={(name, value) => setValues(name, value)}
      />
    </ToolCard>
  );
}

export default function AgentUiGallery() {
  const pulse = usePulse();
  const status = (): ToolStatus => (pulse() ? 'running' : 'completed');
  const count = useCounter();

  return (
    <StaticMarkdownContext>
      <div class="size-full overflow-auto">
        <div class="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
          <Item label="Tool calls (live replay)">
            <ToolReplayDemo />
          </Item>

          <Item label="DisplayResults (inline between groups)">
            <DisplayResultsDemo />
          </Item>
          <Item label="ElicitationForm (live validation)">
            <ElicitationFormDemo />
          </Item>

          <Item label="MagicChip (booting, writing, done)">
            <MagicChipStateDemo
              presentation={{
                kind: 'working',
                activity: {
                  label: 'Booting agent',
                  detail: 'Preparing workspace',
                  busy: true,
                },
              }}
            />
            <MagicChipStateDemo
              presentation={{
                kind: 'answering',
                markdown:
                  'The failing test is in `agent_fold`: the batch fold re-derives every message per frame, so the',
                activity: {
                  label: 'Running command',
                  detail: 'cargo test -p agent_fold',
                  busy: true,
                },
              }}
            />
            <MagicChipStateDemo
              presentation={{
                kind: 'settled',
                markdown:
                  '**Fixed.** The incremental machine now handles the replay; `cargo test -p agent_fold` passes.',
              }}
            />
          </Item>

          <Item label="MagicChip asking (form, url, tool draft)">
            <MagicChipAskingDemo
              request={{ kind: 'form', schema: FIXTURE_ELICITATION }}
            />
            <MagicChipAskingDemo
              request={{
                kind: 'url',
                elicitationId: 'gh-1',
                url: 'https://github.com/login/device?user_code=ABCD-1234',
              }}
            />
            <MagicChipAskingDemo
              request={{
                kind: 'user_tool',
                tool: 'CreateCalendarEvent',
                draft: {
                  title: 'Q3 sync',
                  time: {
                    kind: 'timed',
                    startsAt: '2026-08-20T17:00:00Z',
                    endsAt: '2026-08-20T17:30:00Z',
                    timeZone: 'UTC',
                  },
                  attendees: [],
                  recurrenceLines: [],
                  addGoogleMeet: false,
                  eventType: 'default',
                },
                schema: FIXTURE_ELICITATION,
              }}
            />
          </Item>

          <Item label="ComposerNotice">
            <ComposerNotice text="Waking the agent's sandbox…" active />
          </Item>

          <Item label="ActionLine">
            <ActionLine label="Setting model to claude-opus-5…" />
            <ActionLine label="Model set to claude-opus-5" />
            <ActionLine label="Context compacted" />
            <ActionLine
              label="Couldn't switch to openai/gpt-5"
              failed
              detail="no credentials configured for provider openai"
            />
            <ActionLine
              label="An error was encountered with your session. Send another message to continue — Internal error: Bad Request: bad request: Authorization header is badly formatted"
              detail="Internal error: Bad Request: bad request: Authorization header is badly formatted"
              failed
            />
          </Item>

          <Item label="ToolCard">
            <ToolCard
              title="Shell"
              icon={<Terminal />}
              subtitle="cargo test -p agent_fold"
              status={status()}
            />
            <ToolCard
              title="Read"
              icon={<FileText />}
              subtitle="crates/agent_fold/src/domain/fold.rs"
              args={{ limit: '200' }}
              status="completed"
            />
            <ToolCard
              title="Edit"
              icon={<PencilSimple />}
              subtitle={FIXTURE_DIFF.path}
              trailing={<DiffChanges additions={4} deletions={3} />}
              status="completed"
            >
              <PierreDiff diffs={[FIXTURE_DIFF]} />
            </ToolCard>
          </Item>

          <Item label="ToolGroup (active / settled)">
            <ToolGroup count={3} active={pulse()}>
              <ToolCard
                title="Read"
                icon={<FileText />}
                subtitle="crates/agent_fold/src/domain/fold.rs"
                status="completed"
              />
              <ToolCard
                title="Edit"
                icon={<PencilSimple />}
                subtitle={FIXTURE_DIFF.path}
                status="completed"
              />
              <ToolCard
                title="Shell"
                icon={<Terminal />}
                subtitle="cargo test -p agent_fold"
                status={pulse() ? 'running' : 'completed'}
              />
            </ToolGroup>
            <ToolGroup count={2} active={false} defaultOpen>
              <ToolCard
                title="Search"
                icon={<MagnifyingGlass />}
                subtitle="fold"
                status="completed"
                trailing="3 results"
              />
              <ToolCard title="Read" icon={<FileText />} status="completed" />
            </ToolGroup>
          </Item>

          <Item label="Thought (active / settled)">
            <Thought
              text="The batch fold re-derives every message per frame; the incremental machine already handles this."
              active={pulse()}
            />
            <Thought
              text="The incremental machine is the right default."
              defaultOpen
            />
          </Item>

          <Item label="ToolStatusTitle / TextShimmer">
            <ToolStatusTitle
              active={pulse()}
              activeText="Gathering context"
              doneText="Gathered context"
            />
            <TextShimmer text="Thinking about the fold" active={pulse()} />
          </Item>

          <Item label="AnimatedNumber / CountSummary">
            <div class="text-sm text-ink">
              <AnimatedNumber value={count()} />
            </div>
            <CountSummary
              items={[
                {
                  key: 'read',
                  count: count(),
                  one: 'file read',
                  other: 'files read',
                },
                { key: 'search', count: 2, one: 'search', other: 'searches' },
              ]}
            />
          </Item>

          <Item label="TodoList">
            <TodoList
              todos={[
                {
                  content: 'Read the fold implementation',
                  status: 'completed',
                },
                {
                  content: 'Swap batch fold for the machine',
                  status: 'in_progress',
                },
                { content: 'Run the crate tests', status: 'pending' },
                {
                  content: 'Benchmark against the recording',
                  status: 'cancelled',
                },
              ]}
            />
          </Item>

          <Item label="QuestionAnswers">
            <QuestionAnswers
              questions={[
                {
                  question: 'Which fold strategy should be the default?',
                  answers: ['Incremental machine'],
                },
                { question: 'Keep the batch entry point?', answers: [] },
              ]}
            />
          </Item>

          <Item label="ToolErrorCard">
            <ToolErrorCard
              tool="Bash"
              error="Bash: command timed out after 120s: cargo test -p agent_fold"
            />
          </Item>

          <Item label="DiffChanges">
            <div class="flex items-center gap-4 text-xs">
              <DiffChanges additions={18} deletions={6} />
              <DiffChanges additions={18} deletions={6} variant="bars" />
              <DiffChanges additions={0} deletions={412} variant="bars" />
            </div>
          </Item>

          <Item label="Reply to selection">
            <ReplyToSelectionDemo />
          </Item>

          <Item label="AgentInput (idle / busy)">
            <AgentInput
              onSend={(content) => console.info('[gallery] send', content)}
            />
            <AgentInput
              busy
              onSend={() => {}}
              onStop={() => console.info('[gallery] stop')}
            />
          </Item>

          <Item label="AgentInput with model selector (harness names)">
            <ModelSelectorDemo
              options={FIXTURE_MODELS}
              initialModel="grok-4.6-high-fast"
            />
          </Item>

          <Item label="AgentInput with model selector (slug-named catalog)">
            <p class="text-xs text-ink-muted">
              What Macro Agent reports: names that are only ids, shown as names
              with their provider's logo.
            </p>
            <ModelSelectorDemo
              options={FIXTURE_INMEM_MODELS}
              initialModel="anthropic/claude-sonnet-5"
            />
          </Item>

          <Item label="AgentMessage (end-to-end)">
            <Message message={FIXTURE_MESSAGE} inFlight={false} />
          </Item>

          <Item label="AgentMessage (multi-artifact loading)">
            <p class="text-xs text-ink-muted">
              Walkthrough files without a known size reserve a 16:9 card each,
              named from the file, instead of a stack of floating spinners.
            </p>
            <div class="max-w-xl text-base">
              <p class="mb-1 text-sm text-ink-muted">Thoughted</p>
              <p class="mb-2">Done and looking good.</p>
              <MarkdownImage
                key="artifact-image-1"
                srcType="url"
                id=""
                url=""
                alt="walkthrough.png"
                width={0}
                height={0}
                scale={1}
              />
              <MarkdownImage
                key="artifact-image-2"
                srcType="url"
                id=""
                url=""
                alt="agents_list.png"
                width={0}
                height={0}
                scale={1}
              />
              <MediaLoadingPlaceholder kind="video" label="demo.mp4" />
            </div>
          </Item>

          <Item label="AgentMessage (Cursor turn in flight)">
            <p class="text-xs text-ink-muted">
              Earlier reasoning has settled. Only the trailing thought still
              says Thinking.
            </p>
            <Message message={FIXTURE_IN_FLIGHT} inFlight />
          </Item>

          <Item label="AgentMessage (turn settles)">
            <LiveTurnDemo />
          </Item>

          <Item label="AgentMessage (prompts: yours, then another participant's)">
            <PromptAuthorDemo />
          </Item>
        </div>
      </div>
    </StaticMarkdownContext>
  );
}
