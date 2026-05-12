import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';
import { createMemo, Show } from 'solid-js';

export function CallRecordingSummarySection(props: {
  record: Accessor<CallRecord>;
}) {
  const summary = createMemo(() => {
    const value = props.record().summary;
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

  const isPending = createMemo(
    () =>
      !summary() &&
      !props.record().isActive &&
      props.record().transcript.length > 0
  );

  const shouldShow = createMemo(() => summary() || isPending());

  return (
    <Show when={shouldShow()}>
      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-ink">Summary</h3>
        <Show
          when={summary()}
          fallback={
            <div class="flex items-center gap-2 animate-pulse">
              <div class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-ink-extra-muted border-t-ink-muted" />
              <span class="text-sm text-ink-faint">Generating summary…</span>
            </div>
          }
        >
          {(text) => (
            <p class="text-sm/6 text-ink text-pretty whitespace-pre-wrap">
              {text()}
            </p>
          )}
        </Show>
      </section>
    </Show>
  );
}
