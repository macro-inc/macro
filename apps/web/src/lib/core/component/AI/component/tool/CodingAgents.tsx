import CodeIcon from '@phosphor/code.svg';
import { createSignal, For, type JSX, Show, Suspense } from 'solid-js';
import { MagicChip } from '../../../LexicalMarkdown/component/decorator/MagicChip';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, useToolError } from './ToolRenderer';

export const listCodingAgentsHandler = createToolRenderer({
  name: 'ListCodingAgents',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const agents = () => ctx.response?.data.agents ?? [];
    return (
      <BaseTool
        icon={CodeIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response && expanded() ? (
            <Tool.List>
              <For
                each={agents()}
                fallback={
                  <Tool.ListItem>No coding agents available.</Tool.ListItem>
                }
              >
                {(agent) => (
                  <Tool.ListItem>
                    <div class="min-w-0 space-y-1 text-xs">
                      <div class="text-ink">{agent.name}</div>
                      <Show when={agent.description}>
                        <div class="text-ink-muted">{agent.description}</div>
                      </Show>
                    </div>
                  </Tool.ListItem>
                )}
              </For>
            </Tool.List>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Available coding agents</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!ctx.response}
            status={
              ctx.response
                ? `${agents().length} ${agents().length === 1 ? 'agent' : 'agents'}`
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

function DispatchStatus(props: { children: JSX.Element }) {
  return (
    <div
      class="flex items-center gap-2 py-2 text-sm text-ink-muted"
      role="status"
    >
      <CodeIcon class="size-4 shrink-0" />
      <span>{props.children}</span>
    </div>
  );
}

export const dispatchCodingAgentHandler = createToolRenderer({
  name: 'DispatchCodingAgent',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <DispatchStatus>
            {error()
              ? 'Could not confirm coding agent dispatch'
              : 'Starting coding agent…'}
          </DispatchStatus>
        }
      >
        {(result) => (
          <Suspense
            fallback={<DispatchStatus>Loading coding session…</DispatchStatus>}
          >
            <MagicChip
              agentSessionId={result().agent_session_id}
              promptedMessage={{ turn: 0, author: 'user' }}
              status="booting"
            />
          </Suspense>
        )}
      </Show>
    );
  },
});
