import Newspaper from '@phosphor-icons/core/regular/newspaper.svg';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

export const readAgentSessionHandler = createToolRenderer({
  name: 'ReadAgentSession',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const response = () => ctx.response?.data;
    return (
      <BaseTool
        icon={Newspaper}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={expanded() && response()}>
            {(result) => (
              <div class="max-h-96 overflow-auto space-y-3 p-3">
                <p class="text-ink-muted">
                  {result().name} · {result().status}
                  {result().isArchived ? ' · Archived' : ''}
                </p>
                <Show when={result().truncated}>
                  <p class="text-ink-muted">
                    Some history or message text was omitted.
                  </p>
                </Show>
                <For each={result().messages}>
                  {(message) => (
                    <div>
                      <div class="text-ink-muted">
                        {message.role} · Turn {message.turn}
                      </div>
                      <pre class="whitespace-pre-wrap break-words font-sans">
                        {message.content}
                      </pre>
                      <Show when={message.truncated}>
                        <span class="text-ink-muted">Message truncated</span>
                      </Show>
                      <Show when={message.failure}>
                        {(failure) => (
                          <p class="whitespace-pre-wrap break-words">
                            Failed: {failure()}
                          </p>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        }
      >
        <span class="min-w-0 flex-1">Read agent session</span>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
          showToggle={!!response()}
          status={
            response() ? `${response()?.messages.length} messages` : undefined
          }
        />
      </BaseTool>
    );
  },
});
