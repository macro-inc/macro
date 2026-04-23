import Microphone from '@phosphor-icons/core/regular/microphone.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadCallRecord',
  render: (ctx) => (
    <BaseTool type="call" icon={Microphone} renderContext={ctx.renderContext}>
      Read call transcript{' '}
      <span class="text-accent">{ctx.tool.data.callId}</span>
    </BaseTool>
  ),
});

export const readCallRecordHandler = handler;
