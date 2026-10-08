import CaretRight from '@phosphor-icons/core/regular/caret-right.svg';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

export const discoverConnectorsHandler = createToolRenderer({
  name: 'DiscoverConnectors',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const result = () => ctx.response?.data.result;
    const entries = () => {
      const response = result();
      if (!response) return [];
      return response.operation === 'search'
        ? response.apps.map((app) => ({
            name: app.name,
            description: app.description,
          }))
        : response.tools;
    };
    const summary = () => {
      const response = result();
      if (!response) return '';
      return response.operation === 'search'
        ? `${response.apps.length} apps found${response.more_results ? ' (narrow search for more)' : ''}`
        : `${response.app.name}: ${response.connected ? 'connected' : 'not connected'} · ${response.tools.length}${response.tools_truncated ? '+' : ''} tools`;
    };
    return (
      <BaseTool
        icon={MagnifyingGlass}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={expanded()}>
            <ul class="space-y-2 text-xs">
              <For each={entries()}>
                {(entry) => (
                  <li>
                    <span class="font-medium">{entry.name}</span>
                    <p class="text-ink-muted">{entry.description}</p>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        }
      >
        <span class="flex-1">Discover connectors</span>
        <Show when={ctx.response}>
          <span class="text-ink-muted text-xs">{summary()}</span>
          <button
            type="button"
            aria-label="Show connector results"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            <CaretRight
              class="size-4"
              classList={{ 'rotate-90': expanded() }}
            />
          </button>
        </Show>
      </BaseTool>
    );
  },
});
