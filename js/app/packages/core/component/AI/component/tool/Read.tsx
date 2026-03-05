import EyeIcon from '@phosphor-icons/core/regular/eye.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'Read',
  renderCall: (ctx) => (
    <BaseTool type="call" icon={EyeIcon} renderContext={ctx.renderContext}>
      Read{' '}
      <span class="text-accent">
        {ctx.tool.data.ids.length}{' '}
        {ctx.tool.data.contentType + (ctx.tool.data.ids.length > 1 ? 's' : '')}
      </span>
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const readHandler = handler;
