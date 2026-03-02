import { InlineItemPreview } from '@core/component/ItemPreview';
import Info from '@phosphor-icons/core/regular/info.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadMetadata',
  renderCall: (ctx) => (
    <BaseTool icon={Info} renderContext={ctx.renderContext} type="call">
      Read metadata of{' '}
      <InlineItemPreview id={ctx.tool.data.documentId} type="document" />
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const readMetadataHandler = handler;
