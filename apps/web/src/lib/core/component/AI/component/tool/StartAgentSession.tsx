import AgentIcon from '@phosphor/sparkle.svg';
import { Show, Suspense } from 'solid-js';
import { MagicChip } from '../../../LexicalMarkdown/component/decorator/MagicChip';
import { createToolRenderer, useToolError } from './ToolRenderer';

export const startAgentSessionHandler = createToolRenderer({
  name: 'StartAgentSession',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={ctx.response?.data}
        fallback={
          <div
            class="flex items-center gap-2 py-2 text-sm text-ink-muted"
            role="status"
          >
            <AgentIcon class="size-4 shrink-0" />
            <span>
              {error()
                ? 'Could not confirm agent session start'
                : 'Starting agent session…'}
            </span>
          </div>
        }
      >
        {(result) => (
          <Suspense fallback={<div role="status">Loading agent session…</div>}>
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
