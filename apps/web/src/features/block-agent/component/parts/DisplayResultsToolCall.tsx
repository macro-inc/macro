/** DisplayResults is message content, rendered directly from the call's view. */

import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { deserializeToolCall } from '@service-cognition/generated/tools/tool';
import { createMemo, ErrorBoundary, Show, Suspense } from 'solid-js';
import { isToolActive, TextShimmer } from '../../ui';
import type { ToolCallCommon } from './shared';

export function DisplayResultsToolCall(props: {
  input: unknown;
  common: ToolCallCommon;
}) {
  const view = createMemo(() => {
    const call = deserializeToolCall({
      id: props.common.id,
      name: 'DisplayResults',
      json: props.input,
    });
    if (call.isErr() || !('view' in call.value.data)) return undefined;
    return { value: call.value.data.view };
  });
  const unavailable = () => (
    <p class="text-xs text-ink-extra-muted" role="status">
      Unable to display these results.
    </p>
  );

  return (
    <ErrorBoundary fallback={unavailable()}>
      <Suspense
        fallback={<p class="text-xs text-ink-extra-muted">Loading results…</p>}
      >
        <Show
          when={view()}
          fallback={
            <Show
              when={isToolActive(props.common.status)}
              fallback={unavailable()}
            >
              <TextShimmer text="Preparing results…" active={true} />
            </Show>
          }
        >
          {(current) => <DashboardToolView view={current().value} />}
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
}
