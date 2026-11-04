import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { Show } from 'solid-js';
import type { View } from './view';
import { Widget } from './widget';

/**
 * Renders a view the server decoded: a `DisplayResults` result or a view an
 * agent presented.
 *
 * Lives in the `app` package (not `core`) because the dynamic-ui lib depends on
 * `app` internals; the core tool handler lazy-imports this to avoid a circular
 * dependency. Default export so it can be `lazy()`-loaded.
 */
export default function DashboardToolView(props: {
  view: View | undefined;
  pending?: boolean;
}) {
  return (
    <Show
      when={props.view}
      fallback={
        <Show when={!props.pending}>
          <div class="text-ink-extra-muted rounded-lg border border-edge-muted p-3 text-xs">
            Couldn't render dashboard.
          </div>
        </Show>
      }
    >
      {(view) => (
        <StaticMarkdownContext theme={aiChatTheme}>
          <Widget.Compose view={view()} />
        </StaticMarkdownContext>
      )}
    </Show>
  );
}
