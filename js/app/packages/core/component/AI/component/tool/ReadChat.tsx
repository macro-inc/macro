import { ItemPreview } from '@core/component/ItemPreview';
import Newspaper from '@phosphor-icons/core/regular/newspaper.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadChat',
  render: (ctx) => (
    <BaseTool icon={Newspaper} renderContext={ctx.renderContext} type="call">
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span>
          Read <span class="text-accent">chat</span>
        </span>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          <ItemPreview id={ctx.tool.data.chatId} type="chat" />
        </span>
      </div>
    </BaseTool>
  ),
});

export const readChatHandler = handler;
