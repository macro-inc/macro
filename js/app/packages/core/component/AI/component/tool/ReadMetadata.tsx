import { ItemPreview } from '@core/component/ItemPreview';
import Info from '@phosphor-icons/core/regular/info.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadMetadata',
  renderCall: (ctx) => (
    <BaseTool icon={Info} renderContext={ctx.renderContext} type="call">
      <div class="flex flex-row gap-2">
        <div>Get info of </div>
        <ItemPreview id={ctx.tool.data.documentId} type="document" />
      </div>
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const readMetadataHandler = handler;
