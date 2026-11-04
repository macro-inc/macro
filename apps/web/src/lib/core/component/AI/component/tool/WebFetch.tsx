import Globe from '@icon/system/regular/globe.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

// Runtime type for successful web fetch (schema differs from generated types)
const handler = createToolRenderer({
  name: 'WebFetch',
  render: (ctx) => (
    <BaseTool icon={Globe} renderContext={ctx.renderContext} type="call">
      {ctx.response ? 'Fetched' : 'Fetch'}{' '}
      <a
        href={ctx.tool.data.input}
        target="_blank"
        rel="noopener noreferrer"
        class="italic text-ink underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2 hover:decoration-current"
      >
        {ctx.tool.data.input}
      </a>
    </BaseTool>
  ),
});

export const webFetchHandler = handler;
