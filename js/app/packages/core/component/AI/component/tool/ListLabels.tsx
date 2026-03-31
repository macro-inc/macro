import Tag from '@phosphor-icons/core/regular/tag.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ListLabels',
  renderCall: (ctx) => (
    <BaseTool icon={Tag} renderContext={ctx.renderContext} type="call">
      List email labels
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const listLabelsHandler = handler;
