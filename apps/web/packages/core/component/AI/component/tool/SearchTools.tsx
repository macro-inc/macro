import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'SearchTools',
  render: (ctx) => {
    const count = () => ctx.response?.data.results.length ?? 0;
    const countText = () => {
      if (count() === 0) return 'No tools found';
      if (count() === 1) return '1 tool found';
      return `${count()} tools found`;
    };

    return (
      <BaseTool
        icon={MagnifyingGlass}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            Searched tools for{' '}
            <span class="text-ink">{ctx.tool.data.query}</span>
          </span>
          <Show when={ctx.response}>
            <span class="shrink-0 text-ink-extra-muted">{countText()}</span>
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const searchToolsHandler = handler;
