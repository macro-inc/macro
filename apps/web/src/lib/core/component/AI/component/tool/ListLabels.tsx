import TagSimple from '@phosphor-icons/core/regular/tag-simple.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ListLabels',
  render: (ctx) => (
    <BaseTool icon={TagSimple} renderContext={ctx.renderContext} type="call">
      List email labels
    </BaseTool>
  ),
});

export const listLabelsHandler = handler;
