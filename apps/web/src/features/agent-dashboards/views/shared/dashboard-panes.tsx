import { View as ViewLayout } from '@app/features/dynamic-ui/core/Layout';
import { titledWidgets } from '@app/features/dynamic-ui/core/view-title';
import { Render } from '@app/features/dynamic-ui/render';
import type { View, Widget } from '@app/features/dynamic-ui/view';
import { AgentScope } from '@app/features/dynamic-ui/widgets/panes/agent-scope';
import { t } from '@app/lib/i18n';
import { TraceFlow } from '@app/observability/flow';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { Telemetry } from '@macro-inc/observability';
import { createMemo, ErrorBoundary, For, Suspense } from 'solid-js';
import { PaneLoading } from '../../components/dashboard-states';

/**
 * One top-level pane. Each loads and fails on its own, and each is a
 * `dashboard.pane` flow under the view's, so a slow pane shows in the trace.
 * The flow sits inside the Suspense so it stays open while the pane loads.
 */
function Pane(props: { widget: Widget; index: number }) {
  const attributes = () => {
    const base = {
      'dashboard.pane.index': props.index,
      'dashboard.pane.type': props.widget.type,
    };
    const id = props.widget.id;
    return id === undefined ? base : { ...base, 'dashboard.pane.id': id };
  };

  return (
    <ErrorBoundary
      fallback={(error) => {
        Telemetry.error(error, {
          surface: 'agent-dashboards',
          widgetType: props.widget.type,
        });
        return (
          <div class="rounded border border-dashed border-edge-muted p-3 text-xs text-ink-extra-muted">
            {t('agentDashboards.paneFailed')}
          </div>
        );
      }}
    >
      <Suspense fallback={<PaneLoading />}>
        <TraceFlow name="dashboard.pane" attributes={attributes()}>
          <Render node={props.widget} />
        </TraceFlow>
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * A dashboard's view, read-only, with each widget fetching as the viewer.
 * The dashboard's owner is the agent its agent panes show when they name
 * none.
 */
export function DashboardPanes(props: { view: View; ownerId: string }) {
  const shown = createMemo(() => titledWidgets(props.view));

  return (
    <AgentScope agentId={props.ownerId}>
      <StaticMarkdownContext theme={aiChatTheme}>
        <ViewLayout title={shown().title}>
          <For each={shown().widgets}>
            {(widget, index) => <Pane widget={widget} index={index()} />}
          </For>
        </ViewLayout>
      </StaticMarkdownContext>
    </AgentScope>
  );
}
