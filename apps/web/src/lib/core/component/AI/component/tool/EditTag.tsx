import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import { TagDot } from '@property/tags/TagDot';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'EditTag',
  render: (ctx) => {
    const label = () => ctx.response?.data.label ?? ctx.tool.data.label;
    const color = () => ctx.response?.data.color ?? undefined;
    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="shrink-0">
            {ctx.response ? 'Edited tag' : 'Edit tag'}
          </span>
          <Show when={color()}>{(c) => <TagDot color={c()} />}</Show>
          <Show when={label()}>
            {(l) => <span class="truncate text-ink">{l()}</span>}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const editTagHandler = handler;
