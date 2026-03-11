import Globe from '@phosphor-icons/core/regular/globe.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

// Runtime type for successful web fetch (schema differs from generated types)
const handler = createToolRenderer({
  name: 'web_fetch',
  renderCall: (ctx) => (
    <BaseTool icon={Globe} renderContext={ctx.renderContext} type="call">
      Fetched{' '}
      <a
        href={ctx.tool.data.url}
        target="_blank"
        rel="noopener noreferrer"
        class="italic text-accent hover:underline"
      >
        {ctx.tool.data.url}
      </a>
    </BaseTool>
  ),
  renderResponse: (_) => undefined,
});

export const webFetchHandler = handler;
