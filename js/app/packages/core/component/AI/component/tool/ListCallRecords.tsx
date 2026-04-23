import PhoneList from '@phosphor-icons/core/regular/phone-list.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ListCallRecords',
  render: (ctx) => (
    <BaseTool type="call" icon={PhoneList} renderContext={ctx.renderContext}>
      List call records
      {ctx.tool.data.channelId ? (
        <>
          {' '}
          in <span class="text-accent">channel {ctx.tool.data.channelId}</span>
        </>
      ) : null}
    </BaseTool>
  ),
});

export const listCallRecordsHandler = handler;
