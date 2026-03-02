import { InlineItemPreview } from '@core/component/ItemPreview';
import FileText from '@phosphor-icons/core/regular/file-text.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadContent',
  renderCall: (ctx) => (
    <BaseTool icon={FileText} renderContext={ctx.renderContext} type="call">
      <div class="py-1 justify-center">
        Read
        <span class="px-1">
          <InlineItemPreview id={ctx.tool.data.documentId} type="document" />
        </span>
      </div>
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const readContentHandler = handler;
