import { For, Show } from 'solid-js';
import type { AttentionReason, Enrollment } from '../core/model';
import { AttentionBadge, StatusBadge } from './status-badge';

export function ContactEnrollments(props: {
  entries: Enrollment[];
  loading?: boolean;
  error?: string;
  onOpen?: () => void;
  /** A problem to show instead of the stored status, when the host knows one. */
  attention?: (entry: Enrollment) => AttentionReason | undefined;
}) {
  return (
    <section
      class="rounded-xl border border-edge-muted bg-panel/30 p-4"
      aria-label="Email Marketing enrollments"
    >
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-sm font-medium">Email Marketing</h3>
        <Show when={props.onOpen}>
          <button
            type="button"
            onClick={props.onOpen}
            class="text-xs text-accent hover:underline"
          >
            Open module ↗
          </button>
        </Show>
      </div>
      <Show when={props.error}>
        <p class="text-xs text-failure" role="alert">
          {props.error}
        </p>
      </Show>
      <Show
        when={!props.error && !props.loading}
        fallback={
          <Show when={props.loading}>
            <p class="text-xs text-ink-muted">Loading enrollments…</p>
          </Show>
        }
      >
        <Show
          when={props.entries.length}
          fallback={
            <p class="text-xs text-ink-muted">
              This contact is not enrolled in any sequences.
            </p>
          }
        >
          <div class="flex flex-col gap-2">
            <For each={props.entries}>
              {(entry) => (
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm">{entry.campaignName}</p>
                    <p class="text-xs text-ink-muted">
                      {
                        entry.steps.filter((step) => step.status === 'queued')
                          .length
                      }{' '}
                      scheduled emails
                    </p>
                  </div>
                  <Show
                    when={props.attention?.(entry)}
                    fallback={<StatusBadge status={entry.status} />}
                  >
                    {(reason) => <AttentionBadge reason={reason()} />}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}
