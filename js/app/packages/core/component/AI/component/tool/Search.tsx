import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

function createSearchHandler(name: 'NameSearch' | 'ContentSearch') {
  return createToolRenderer({
    name,
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
        text={`Found ${ctx.tool.data.results.length} matches`}
        renderContext={ctx.renderContext}
        type="response"
      ></BaseTool>
    ),
  });
}

export const nameSearchHandler = createSearchHandler('NameSearch');
export const contentSearchHandler = createSearchHandler('ContentSearch');
