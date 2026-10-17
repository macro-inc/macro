import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import SquaresFour from '@phosphor/squares-four.svg';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer, useToolError } from './ToolRenderer';

/**
 * `displayResults` renders the AI-composed view from the tool CALL arguments
 * (`ctx.tool.data.view`) using the dynamic-ui component library. The tool
 * RESPONSE is intentionally not rendered.
 *
 * A call the tool turned back - its view did not match the schema - is a
 * failed row, not the view: the agent sends the view again, fixed, and the
 * widgets that did match would otherwise show twice.
 *
 * `DashboardToolView` is imported from `@app` already wrapped in `lazy()` — the
 * dynamic-ui tree is entity-heavy and lives in a module-init cycle, so the lazy
 * boundary (owned by `@app`, like the split-layout component registry) keeps it
 * out of the eager startup graph. See `DashboardToolView.lazy.ts`.
 */
const handler = createToolRenderer({
  name: 'DisplayResults',
  render: (ctx) => {
    const error = () => useToolError();
    return (
      <Show
        when={!error()}
        fallback={
          <BaseTool
            icon={SquaresFour}
            renderContext={ctx.renderContext}
            type="call"
          >
            <span class="min-w-0 truncate">Display results</span>
          </BaseTool>
        }
      >
        <DashboardToolView view={ctx.tool.data.view} />
      </Show>
    );
  },
});

export const displayResultsHandler = handler;
