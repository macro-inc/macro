/**
 * Debug gallery for the block-agent ui library: every pure component with
 * fixture data, plus a full `AgentMessage` rendered end-to-end. Mounted at
 * `/component/agent-ui`.
 */

import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type {
  FoldedMessage,
  ToolStatus,
} from '@service-agent-fold/generated/types';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { Message } from '../component/AgentMessage';
import { ReplyToSelection } from '../component/ReplyToSelection';
import {
  ActionLine,
  AgentInput,
  AnimatedNumber,
  ComposerNotice,
  CountSummary,
  DiffChanges,
  PierreDiff,
  QuestionAnswers,
  type QuoteInsert,
  TextShimmer,
  Thought,
  TodoList,
  ToolCard,
  ToolErrorCard,
  ToolStatusTitle,
} from '../ui';

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
        <Message message={FIXTURE_MESSAGE} />
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

const FIXTURE_MESSAGE: FoldedMessage = {
  agentSessionId: 'demo',
  requestId: null,
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
      rawInput: null,
      rawOutput: null,
      id: 'demo-read',
      label: 'Read',
      status: 'completed',
      detail: { kind: 'read', paths: ['crates/agent_fold/src/domain/fold.rs'] },
    },
    {
      kind: 'tool_use',
      rawInput: null,
      rawOutput: null,
      id: 'demo-search',
      label: 'Search',
      status: 'completed',
      detail: {
        kind: 'search',
        paths: ['crates/agent_fold/src'],
        output: 'fold.rs:12: fn fold(log: &[Frame]) -> Vec<Message>',
      },
    },
    {
      kind: 'tool_use',
      rawInput: null,
      rawOutput: null,
      id: 'demo-edit',
      label: 'Edit',
      status: 'completed',
      detail: { kind: 'edit', diffs: [FIXTURE_DIFF] },
    },
    {
      kind: 'tool_use',
      rawInput: null,
      rawOutput: null,
      id: 'demo-terminal',
      label: 'Bash',
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
      toolCall: 'demo-terminal',
      options: [
        { id: 'allow', name: 'Allow', kind: 'allow_once' },
        { id: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
      outcome: { kind: 'selected', optionId: 'allow' },
    },
  ],
};

export default function AgentUiGallery() {
  const pulse = usePulse();
  const status = (): ToolStatus => (pulse() ? 'running' : 'completed');
  const count = useCounter();

  return (
    <StaticMarkdownContext>
      <div class="size-full overflow-auto">
        <div class="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
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
              label="The agent couldn't answer — Internal error: Bad Request: bad request: Authorization header is badly formatted"
              detail="Internal error: Bad Request: bad request: Authorization header is badly formatted"
              failed
            />
          </Item>

          <Item label="ToolCard">
            <ToolCard
              title="Bash"
              subtitle="cargo test -p agent_fold"
              status={status()}
            />
            <ToolCard
              title="Read"
              subtitle="crates/agent_fold/src/domain/fold.rs"
              args={{ limit: '200' }}
              status="completed"
            />
            <ToolCard
              title="Edit"
              subtitle={FIXTURE_DIFF.path}
              trailing={<DiffChanges additions={4} deletions={3} />}
              status="completed"
              defaultOpen
            >
              <PierreDiff diffs={[FIXTURE_DIFF]} />
            </ToolCard>
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

          <Item label="AgentMessage (end-to-end)">
            <Message message={FIXTURE_MESSAGE} />
          </Item>
        </div>
      </div>
    </StaticMarkdownContext>
  );
}
