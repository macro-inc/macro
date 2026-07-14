import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { createMemo, Show } from 'solid-js';
import { ViewSchema } from './schema';
import { Widget } from './widget';

/**
 * Renders a `displayResults` tool call's `view` argument as a dashboard.
 *
 * The backend tool input is `any`, so the view arrives as unknown JSON — we
 * validate it against the Zod {@link ViewSchema} here (the schema's source of
 * truth lives on the frontend) and render it with the dynamic-ui component lib.
 *
 * Lives in the `app` package (not `core`) because the dynamic-ui lib depends on
 * `app` internals; the core tool handler lazy-imports this to avoid a circular
 * dependency. Default export so it can be `lazy()`-loaded.
 */
export default function DashboardToolView(props: { view: unknown }) {
  const parsed = createMemo(() => ViewSchema.safeParse(props.view));
  const view = () => {
    const r = parsed();
    return r.success ? r.data : undefined;
  };

  return (
    <Show
      when={view()}
      fallback={
        <div class="text-ink-extra-muted rounded-lg border border-edge-muted p-3 text-xs">
          Couldn't render dashboard — the view didn't match the schema.
        </div>
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
