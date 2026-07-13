import Plus from '@phosphor-icons/core/regular/plus.svg';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'LoadTools',
  render: (ctx) => {
    const count = () => ctx.response?.data.loaded.length ?? 0;
    const countText = () => {
      if (count() === 0) return 'No tools loaded';
      if (count() === 1) return '1 tool loaded';
      return `${count()} tools loaded`;
    };

    return (
      <BaseTool icon={Plus} renderContext={ctx.renderContext} type="call">
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">Loaded tools</span>
          <Show when={ctx.response}>
            <span class="shrink-0 text-ink-extra-muted">{countText()}</span>
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const loadToolsHandler = handler;
