import Newspaper from '@phosphor-icons/core/regular/newspaper.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadThread',
  render: (ctx) => (
    <BaseTool type="call" icon={Newspaper} renderContext={ctx.renderContext}>
      Read{' '}
      <span class="text-accent">
        {ctx.tool.data.ids.length}{' '}
        {ctx.tool.data.contentType + (ctx.tool.data.ids.length > 1 ? 's' : '')}
      </span>
    </BaseTool>
  ),
});

export const readThreadHandler = handler;
