import Newspaper from '@lucide/newspaper.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadCallRecord',
  render: (ctx) => (
    <BaseTool type="call" icon={Newspaper} renderContext={ctx.renderContext}>
      Read <span class="text-ink">call transcript</span>
    </BaseTool>
  ),
});

export const readCallRecordHandler = handler;
