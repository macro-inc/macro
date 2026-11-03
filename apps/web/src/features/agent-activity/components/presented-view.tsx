import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import type { View } from '@app/features/dynamic-ui/view';
import { Telemetry } from '@macro-inc/observability';
import { ErrorBoundary, Suspense } from 'solid-js';

/**
 * A view the agent presented, drawn under the steps of the run that presented
 * it. Its widgets name the items they show, and the reader loads those with
 * their own access.
 */
export function PresentedView(props: { view: View }) {
  return (
    <ErrorBoundary
      fallback={(err) => {
        Telemetry.error(err, { surface: 'agent-activity-view' });
        return (
          <p class="text-xs text-ink-extra-muted" role="status">
            Unable to display this view.
          </p>
        );
      }}
    >
      <Suspense
        fallback={<p class="text-xs text-ink-extra-muted">Loading view…</p>}
      >
        <DashboardToolView view={props.view} pending={false} />
      </Suspense>
    </ErrorBoundary>
  );
}
