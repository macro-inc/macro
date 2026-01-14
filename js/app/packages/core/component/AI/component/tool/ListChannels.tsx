import Channel from '@icon/duotone/hash-duotone.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ListChannels',
  renderCall: (ctx) => (
    <BaseTool
      icon={Channel}
      text="Listing channels..."
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={Channel}
      text={`Found ${ctx.tool.data.total} channel${ctx.tool.data.total === 1 ? '' : 's'}`}
      renderContext={ctx.renderContext}
      type="response"
    />
  ),
});

export const listChannelsHandler = handler;
