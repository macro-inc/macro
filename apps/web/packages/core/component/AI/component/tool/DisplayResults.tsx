import { DashboardToolView } from '@app/component/dynamic-ui/DashboardToolView.lazy';
import { createToolRenderer } from './ToolRenderer';

/**
 * `displayResults` renders the AI-composed view from the tool CALL arguments
 * (`ctx.tool.data.view`) using the dynamic-ui component library. The tool
 * RESPONSE is intentionally not rendered.
 *
 * `DashboardToolView` is imported from `@app` already wrapped in `lazy()` — the
 * dynamic-ui tree is entity-heavy and lives in a module-init cycle, so the lazy
 * boundary (owned by `@app`, like the split-layout component registry) keeps it
 * out of the eager startup graph. See `DashboardToolView.lazy.ts`.
 */
const handler = createToolRenderer({
  name: 'DisplayResults',
  render: (ctx) => <DashboardToolView view={ctx.tool.data.view} />,
});

export const displayResultsHandler = handler;
