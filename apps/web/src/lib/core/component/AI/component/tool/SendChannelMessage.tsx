import { useChannelName } from '@core/context/channels';
import PaperPlaneTilt from '@phosphor-icons/core/regular/paper-plane-tilt.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

export const sendChannelMessageHandler = createToolRenderer({
  name: 'SendChannelMessage',
  render: (ctx) => {
    const channelName = useChannelName(ctx.tool.data.channel_id, 'Channel');

    return (
      <BaseTool
        type={ctx.response ? 'response' : 'call'}
        icon={PaperPlaneTilt}
        renderContext={ctx.renderContext}
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Sent message to' : 'Send message to'}{' '}
            <span class="text-ink">{channelName()}</span>
            {ctx.tool.data.thread_id ? ' thread' : ''}
          </span>
        </div>
      </BaseTool>
    );
  },
});
