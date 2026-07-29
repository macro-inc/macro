import Tag from '@phosphor-icons/core/regular/tag.svg';
import { TagDot } from '@property/tags/TagDot';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'CreateTag',
  render: (ctx) => (
    <BaseTool icon={Tag} renderContext={ctx.renderContext} type="call">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="shrink-0">
          {ctx.response ? 'Created tag' : 'Create tag'}
        </span>
        <Show when={ctx.response?.data.color}>
          {(color) => <TagDot color={color()} />}
        </Show>
        <span class="truncate text-ink">
          {ctx.response?.data.label ?? ctx.tool.data.label}
        </span>
      </div>
    </BaseTool>
  ),
});

export const createTagHandler = handler;
