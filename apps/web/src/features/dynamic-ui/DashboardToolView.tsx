import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { createMemo, Show } from 'solid-js';
import { ViewSchema } from './schema';
import { Widget } from './widget';

/**
 * Renders a `displayResults` tool call's `view` argument as a dashboard.
 *
 * The wire input remains unknown JSON so streamed or malformed arguments can
 * reach the renderer. Validate it against the Zod {@link ViewSchema}, which
 * also generates the model-facing tool schema, before composing the widgets.
 *
 * Lives in the `app` package (not `core`) because the dynamic-ui lib depends on
 * `app` internals; the core tool handler lazy-imports this to avoid a circular
 * dependency. Default export so it can be `lazy()`-loaded.
 */
export default function DashboardToolView(props: {
  view: unknown;
  pending?: boolean;
}) {
  // Agent calls open before their input arrives. Render any valid view as it
  // streams in, but only report malformed or missing input once the call ends.
  const pending = () => props.pending ?? props.view == null;
  const parsed = createMemo(() => ViewSchema.safeParse(props.view));
  const view = () => {
    const r = parsed();
    return r.success ? r.data : undefined;
  };

  return (
    <Show
      when={view()}
      fallback={
        <Show when={!pending()}>
          <div class="text-ink-extra-muted rounded-lg border border-edge-muted p-3 text-xs">
            Couldn't render dashboard — the view didn't match the schema.
          </div>
        </Show>
      }
    >
      {(v) => (
        <StaticMarkdownContext theme={aiChatTheme}>
          <Widget.Compose view={v()} />
        </StaticMarkdownContext>
      )}
    </Show>
  );
}
