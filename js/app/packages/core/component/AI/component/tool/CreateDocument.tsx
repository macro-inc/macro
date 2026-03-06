import { ItemPreview } from '@core/component/ItemPreview';
import FilePlus from '@phosphor-icons/core/regular/file-plus.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'CreateDocument',
  renderCall: (ctx) => (
    <BaseTool icon={FilePlus} renderContext={ctx.renderContext} type="call">
      Create{' '}
      <span class="text-accent">
        {ctx.tool.data.documentName}.{ctx.tool.data.fileExtension}
      </span>
    </BaseTool>
  ),
  renderResponse: (ctx) => (
    <BaseTool renderContext={ctx.renderContext} type="response">
      <ItemPreview id={ctx.tool.data.documentId} type="document" />
    </BaseTool>
  ),
});

export const createDocumentHandler = handler;
