import { ItemPreview } from '@core/component/ItemPreview';
import Info from '@phosphor-icons/core/regular/info.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadMetadata',
  render: (ctx) => (
    <BaseTool icon={Info} renderContext={ctx.renderContext} type="call">
      <div class="flex flex-row gap-2">
        <div>Read metadata</div>
        <ItemPreview id={ctx.tool.data.documentId} type="document" />
      </div>
    </BaseTool>
  ),
});

export const readMetadataHandler = handler;
