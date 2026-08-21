import Trash from '@phosphor-icons/core/regular/trash.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'DeleteTag',
  render: (ctx) => (
    <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
      {ctx.response ? 'Deleted tag' : 'Delete tag'}
    </BaseTool>
  ),
});

export const deleteTagHandler = handler;
