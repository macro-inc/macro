// The handler map first: entering the chat tool modules through one of its
// renderers would evaluate that renderer before the module cycle resolves.
import '@core/component/AI/component/tool/handler';
import { subagentHandler } from '@core/component/AI/component/tool/Subagent';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { MessagePart } from '@service-agent-fold/generated/types';
import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import type { ToolUsePart } from '../component/parts/shared';
import { ToolCallPart } from '../component/parts/ToolCallPart';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');

const brief =
  'Use the GitHub search tool (mcp__github__github-search-issues-and-pull-requests; load it via SearchTools "github search issues and pull requests") to list every open pull request the user authored in macro-inc/macro, with each one\'s labels, review state and CI status.\nGroup them by label and report the result as a table.';
const answer =
  'Seven open pull requests: three labelled `bug`, two `feature`, two unlabelled.';

function subagent(
  id: string,
  status: ToolUsePart['status'],
  description: string | null,
  result: Extract<ToolUsePart['detail'], { kind: 'subagent' }>['result']
): ToolUsePart {
  return {
    kind: 'tool_use',
    id,
    name: { kind: 'native', name: 'Subagent' },
    status,
    detail: {
      kind: 'subagent',
      // The fold's choice: the description, else the brief's first line.
      title: description ?? brief.split('\n')[0] ?? '',
      agentType: null,
      description,
      prompt: brief,
      background: false,
      children: [] satisfies MessagePart[],
      result,
    },
  };
}

const finished = {
  text: answer,
  error: null,
  agentId: null,
  model: null,
  durationMs: null,
  tokens: null,
  toolUses: null,
  stats: null,
};
const rows: { label: string; part: ToolUsePart; live: boolean }[] = [
  {
    label: 'running',
    part: subagent('running', 'running', 'List open pull requests', null),
    live: true,
  },
  {
    label: 'completed',
    part: subagent(
      'completed',
      'completed',
      'List open pull requests',
      finished
    ),
    live: false,
  },
  {
    label: 'failed',
    part: subagent('failed', 'failed', 'List open pull requests', {
      ...finished,
      text: null,
      error: 'Subagent failed: GitHub search is not connected',
    }),
    live: false,
  },
  {
    label: 'undescribed',
    part: subagent('undescribed', 'completed', null, finished),
    live: false,
  },
];

render(
  () => (
    <main class="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <section aria-label="Agent session" class="flex min-w-0 flex-col">
        <For each={rows}>
          {(row) => (
            <div data-subagent-row={row.label} class="min-w-0">
              <ToolCallPart
                part={row.part}
                context={{
                  sessionId: 'session',
                  messageId: 'session:1:agent',
                  partIndex: 0,
                  inFlight: row.live,
                  followedBy: () => false,
                }}
              />
            </div>
          )}
        </For>
      </section>
      <section aria-label="AI chat" class="flex min-w-0 flex-col gap-2">
        <For
          each={[
            { label: 'described', description: 'List open pull requests' },
            { label: 'undescribed', description: undefined },
          ]}
        >
          {(row) => (
            <div data-legacy-subagent-row={row.label} class="min-w-0">
              <Dynamic
                component={
                  subagentHandler.render as Component<Record<string, unknown>>
                }
                tool={{
                  name: 'Subagent',
                  data: { description: row.description, task: brief },
                }}
                response={{ name: 'Subagent', data: { result: answer } }}
                renderContext={{
                  isStreaming: false,
                  grouped: false,
                  followedBy: () => false,
                }}
              />
            </div>
          )}
        </For>
      </section>
    </main>
  ),
  root
);
