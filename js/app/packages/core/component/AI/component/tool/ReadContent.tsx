import { InlineItemPreview } from '@core/component/ItemPreview';
import Newspaper from '@phosphor-icons/core/regular/newspaper.svg';
import { Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'ReadContent',
  render: (ctx) => (
    <BaseTool icon={Newspaper} renderContext={ctx.renderContext} type="call">
      <div class="min-w-0 flex-1">
        Read <span class="text-ink">document</span>{' '}
        <span class="text-ink-placeholder">·</span>{' '}
        <Suspense>
          <InlineItemPreview id={ctx.tool.data.documentId} type="document" />
        </Suspense>
      </div>
    </BaseTool>
  ),
});

export const readContentHandler = handler;
