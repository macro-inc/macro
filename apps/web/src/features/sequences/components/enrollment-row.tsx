import { t } from '@app/lib/i18n';
import type {
  EnrollmentAction,
  EnrollmentStatus,
  EnrollmentSummary,
} from '@service-email/generated/schemas';
import { Button } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { EnrollmentStatusBadge, enrollmentDetail, SendTimes } from './status';

function actionLabel(action: EnrollmentAction) {
  return match(action)
    .with('resume', () => t('sequences.resume'))
    .with('pause', () => t('sequences.pause'))
    .with('stop', () => t('sequences.stop'))
    .with('unsubscribe', () => t('sequences.unsubscribe'))
    .exhaustive();
}

/** One person in a sequence. Their sent emails are in Mail and on their record. */
export function EnrollmentRow(props: {
  enrollment: EnrollmentSummary;
  /** The status to show, which a draft or paused sequence holds at paused. */
  status: EnrollmentStatus;
  stepCount: number;
  actions: readonly EnrollmentAction[];
  busy: boolean;
  onAction: (action: EnrollmentAction) => void;
  onOpenContact?: () => void;
}) {
  // Named by the masked heading, not an attribute session replay would record.
  const nameId = createUniqueId();
  const label = () => props.enrollment.contactName || props.enrollment.email;
  return (
    <article
      class="rounded-xl border border-edge-muted p-4"
      aria-labelledby={nameId}
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="ph-no-capture min-w-0">
          <Show
            when={props.onOpenContact}
            fallback={
              <p id={nameId} class="truncate text-sm font-medium">
                {label()}
              </p>
            }
          >
            {(open) => (
              <Button
                id={nameId}
                type="button"
                variant="link"
                size="sm"
                class="max-w-full truncate px-0 text-ink"
                onClick={() => open()()}
              >
                {label()}
              </Button>
            )}
          </Show>
          <p class="truncate text-xs text-ink-muted">
            {props.enrollment.email}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <EnrollmentStatusBadge
            status={props.status}
            reason={props.enrollment.reason}
          />
          <For each={props.actions}>
            {(action) => (
              <Button
                type="button"
                variant={action === 'unsubscribe' ? 'ghost' : 'secondary'}
                size="sm"
                disabled={props.busy}
                onClick={() => props.onAction(action)}
              >
                {actionLabel(action)}
              </Button>
            )}
          </For>
        </div>
      </div>
      <p class="mt-2 flex flex-wrap gap-x-3 text-xs text-ink-muted">
        <span>
          {t('sequences.stepProgress', {
            done: Math.min(props.enrollment.stepsSent, props.stepCount),
            total: props.stepCount,
          })}
        </span>
        <SendTimes
          lastSentAt={props.enrollment.lastSentAt}
          nextSendAt={props.enrollment.nextSendAt}
          sending={props.status === 'active'}
        />
      </p>
      <Show when={enrollmentDetail(props.status, props.enrollment.reason)}>
        {(detail) => <p class="mt-2 text-xs text-ink-muted">{detail()}</p>}
      </Show>
    </article>
  );
}
