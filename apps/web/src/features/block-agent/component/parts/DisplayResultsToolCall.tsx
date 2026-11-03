/**
 * A view is message content: the view a DisplayResults call returned, or the
 * one the harness presents for `execution.views.present`. The server decoded
 * it; the fold hands it over typed.
 */

import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import type { View } from '@app/features/dynamic-ui/view';
import { Telemetry } from '@macro-inc/observability';
import { ErrorBoundary, Show, Suspense } from 'solid-js';
import { isToolActive, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function DisplayResultsToolCall(props: {
  view: View | undefined;
  error?: string | null;
  common: ToolCallCommon;
}) {
  const pending = () => isToolActive(props.common.status);
  const failed = () => props.common.status === 'failed' || props.error != null;
  const unavailable = () => (
    <p class="text-xs text-ink-extra-muted" role="status">
      Unable to display these results.
    </p>
  );

  return (
    <Show
      when={!failed()}
      fallback={
        <ToolCard
          title={props.common.label}
          status="failed"
          muted
          trailing="Failed"
        />
      }
    >
      <ErrorBoundary
        fallback={(err) => {
          Telemetry.error(err, { surface: 'display-results' });
          return unavailable();
        }}
      >
        <Suspense
          fallback={
            <Show when={!pending()}>
              <p class="text-xs text-ink-extra-muted">Loading results…</p>
            </Show>
          }
        >
          <DashboardToolView view={props.view} pending={pending()} />
        </Suspense>
      </ErrorBoundary>
    </Show>
  );
}
