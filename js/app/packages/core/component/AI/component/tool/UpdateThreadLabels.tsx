import TagSimple from '@phosphor-icons/core/regular/tag-simple.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'UpdateThreadLabels',
  render: (ctx) => (
    <BaseTool icon={TagSimple} renderContext={ctx.renderContext} type="call">
      {ctx.tool.data.add ? 'Add' : 'Remove'} label on thread
    </BaseTool>
  ),
});

export const updateThreadLabelsHandler = handler;
