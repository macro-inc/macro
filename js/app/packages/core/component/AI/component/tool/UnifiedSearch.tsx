import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'UnifiedSearch',
  renderCall: (ctx) => (
    <BaseTool
      icon={MagnifyingGlass}
      text="Searching..."
      renderContext={ctx.renderContext}
      type="call"
    />
  ),
  renderResponse: (ctx) => (
    <BaseTool
      icon={MagnifyingGlass}
      text={`Found ${ctx.tool.data.response.totalResults} matches`}
      renderContext={ctx.renderContext}
      type="response"
    ></BaseTool>
  ),
});

export const unifiedSearchHandler = handler;
