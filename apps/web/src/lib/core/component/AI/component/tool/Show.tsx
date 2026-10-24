import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { Show } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

/**
 * `Show` renders the AI-composed view from the tool CALL arguments
 * (`ctx.tool.data.view`) using the dynamic-ui component library. The tool
 * RESPONSE is intentionally not rendered.
 *
 * A call the tool turned back - its view did not match the schema - showed
 * nothing, so it renders nothing: the agent sends the view again, fixed.
 *
 * `DashboardToolView` is imported from `@app` already wrapped in `lazy()` — the
 * dynamic-ui tree is entity-heavy and lives in a module-init cycle, so the lazy
 * boundary (owned by `@app`, like the split-layout component registry) keeps it
 * out of the eager startup graph. See `DashboardToolView.lazy.ts`.
 */
function ShownView(props: { view: unknown }) {
  return (
    <Show when={!useToolError()}>
      <DashboardToolView view={props.view} />
    </Show>
  );
}

export const showHandler = createToolRenderer({
  name: 'Show',
  render: (ctx) => <ShownView view={ctx.tool.data.view} />,
});

/** `Show`, as chats saved before its rename call it. */
export const displayResultsHandler = createToolRenderer({
  name: 'DisplayResults',
  render: (ctx) => <ShownView view={ctx.tool.data.view} />,
});
