import { UnfurledLinkCollection } from '@core/component/Link';
import Globe from '@phosphor-icons/core/regular/globe.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'WebSearch',
  renderCall: (ctx) => (
    <BaseTool
      icon={Globe}
      text="Searching For"
      renderContext={ctx.renderContext}
      type="call"
    >
      <div class="italic">{ctx.tool.data.query}</div>
    </BaseTool>
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={Globe}
      text="Search Results"
      renderContext={ctx.renderContext}
      type="response"
    >
      <UnfurledLinkCollection
        links={ctx.tool.data.results.map((result) => ({
          title: result.name,
          url: result.url,
        }))}
      />
    </BaseTool>
  ),
});

export const webSearchHandler = handler;
