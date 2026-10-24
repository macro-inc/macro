import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { createMemo, Show } from 'solid-js';
import { z } from 'zod';
import { type View, ViewSchema, WidgetSchema } from './schema';
import { Widget } from './widget';

/** A view's frame, whatever its title and widgets hold. */
const ViewFrameSchema = z.object({
  title: z.unknown().optional(),
  widgets: z.array(z.unknown()),
});

/**
 * What of a view the renderer can draw: every widget that matches the
 * schema, and how many do not. One malformed widget leaves the rest of the
 * view standing.
 */
function drawableView(input: unknown): { view?: View; dropped: number } {
  const whole = ViewSchema.safeParse(input);
  if (whole.success) return { view: whole.data, dropped: 0 };
  const frame = ViewFrameSchema.safeParse(input);
  if (!frame.success) return { dropped: 0 };
  const widgets = frame.data.widgets.flatMap((widget) => {
    const parsed = WidgetSchema.safeParse(widget);
    return parsed.success ? [parsed.data] : [];
  });
  const dropped = frame.data.widgets.length - widgets.length;
  if (widgets.length === 0) return { dropped };
  const { title } = frame.data;
  return {
    view: { title: typeof title === 'string' ? title : undefined, widgets },
    dropped,
  };
}

/**
 * Renders a `Show` tool call's `view` argument as a dashboard.
 *
 * The wire input remains unknown JSON so streamed or malformed arguments can
 * reach the renderer. Validate it against the Zod {@link ViewSchema}, which
 * also generates the model-facing tool schema, before composing the widgets.
 * A widget that does not match is left out and counted under the view.
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
  const drawn = createMemo(() => drawableView(props.view));

  return (
    <Show
      when={drawn().view}
      fallback={
        <Show when={!pending()}>
          <div class="text-ink-extra-muted rounded-lg border border-edge-muted p-3 text-xs">
            Couldn't render dashboard — the view didn't match the schema.
          </div>
        </Show>
      }
    >
      {(v) => (
        <>
          <StaticMarkdownContext theme={aiChatTheme}>
            <Widget.Compose view={v()} />
          </StaticMarkdownContext>
          <Show when={!pending() && drawn().dropped}>
            {(dropped) => (
              <div class="text-ink-extra-muted mt-2 text-xs">
                {dropped() === 1
                  ? "Couldn't render one widget — it didn't match the schema."
                  : `Couldn't render ${dropped()} widgets — they didn't match the schema.`}
              </div>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
