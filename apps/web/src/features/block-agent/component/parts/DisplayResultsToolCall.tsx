/** DisplayResults is message content, rendered directly from the call's view. */

import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { ErrorBoundary, Show, Suspense } from 'solid-js';
import { isToolActive, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function DisplayResultsToolCall(props: {
  input: unknown;
  error?: string | null;
  common: ToolCallCommon;
}) {
  const pending = () => isToolActive(props.common.status);
  const failed = () => props.common.status === 'failed' || props.error != null;
  // The dashboard validates partial streamed input with the same schema used
  // for the tool. Pass missing views through so it can distinguish an open
  // call from malformed completed input.
  const view = () =>
    typeof props.input === 'object' &&
    props.input !== null &&
    'view' in props.input
      ? props.input.view
      : undefined;
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
          subtitle={props.common.server}
          status="failed"
          muted
          trailing="Failed"
        />
      }
    >
      <ErrorBoundary fallback={unavailable()}>
        <Suspense
          fallback={
            <Show when={!pending()}>
              <p class="text-xs text-ink-extra-muted">Loading results…</p>
            </Show>
          }
        >
          <DashboardToolView view={view()} pending={pending()} />
        </Suspense>
      </ErrorBoundary>
    </Show>
  );
}
