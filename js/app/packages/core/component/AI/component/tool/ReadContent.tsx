import { ItemPreview } from '@core/component/ItemPreview';
import FileText from '@phosphor-icons/core/regular/file-text.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadContent',
  renderCall: (ctx) => (
    <BaseTool icon={FileText} renderContext={ctx.renderContext} type="call">
      <div class="flex flex-row gap-2">
        <div> Read </div>
        <ItemPreview id={ctx.tool.data.documentId} type="document" />
      </div>
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const readContentHandler = handler;
