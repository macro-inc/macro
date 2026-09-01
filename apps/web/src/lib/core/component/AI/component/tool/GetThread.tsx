import EnvelopeOpen from '@lucide/mail-open.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'GetThread',
  render: (ctx) => (
    <BaseTool icon={EnvelopeOpen} renderContext={ctx.renderContext} type="call">
      Read thread
    </BaseTool>
  ),
});

export const getThreadHandler = handler;
