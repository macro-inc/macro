import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import type { ContactEnrollment } from '@service-email/generated/schemas';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { isRetryable, type SequenceFailure } from '../core/errors';
import { shownStatus } from '../core/sequence';
import { formatDateTime } from './date-time';
import { failureMessage } from './failure-message';
import { InlineFailure } from './inline-failure';
import { EnrollmentStatusBadge } from './status-badge';

/**
 * A contact's sequences, as any teammate sees them: who sends, how it stands,
 * and when. Only the owner can open a sequence; no one sees its emails here.
 */
export function ContactSequences(props: {
  enrollments: readonly ContactEnrollment[];
  failure?: SequenceFailure;
  ownerName: (ownerId: string) => string;
  onRetry: () => void;
  onOpenSequence: (sequenceId: string) => void;
}) {
  return (
    <Show when={props.failure || props.enrollments.length}>
      <section
        class="rounded-xl border border-edge-muted bg-panel/30 p-4"
        aria-label={t('sequences.title')}
      >
        <h3 class="mb-3 text-sm font-medium">{t('sequences.title')}</h3>
        <Show
          when={props.failure}
          fallback={
            <ul class="flex flex-col gap-3">
              <For each={props.enrollments}>
                {(enrollment) => (
                  <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div class="min-w-0 space-y-1">
                      <Show
                        when={enrollment.isOwner}
                        fallback={
                          <p class="truncate text-sm">
                            {enrollment.sequenceName}
                          </p>
                        }
                      >
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          class="max-w-full truncate px-0 text-ink"
                          onClick={() =>
                            props.onOpenSequence(enrollment.sequenceId)
                          }
                        >
                          {enrollment.sequenceName}
                        </Button>
                      </Show>
                      <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <UserIcon id={enrollment.ownerId} size="sm" />
                          <span class="ph-no-capture truncate">
                            {props.ownerName(enrollment.ownerId)}
                          </span>
                        </span>
                        <Show when={enrollment.lastSentAt}>
                          {(sent) => (
                            <span>
                              {t('sequences.lastSent', {
                                time: formatDateTime(sent()),
                              })}
                            </span>
                          )}
                        </Show>
                        <Show
                          when={
                            shownStatus(
                              enrollment,
                              enrollment.sequencePaused
                            ) === 'active' && enrollment.nextSendAt
                          }
                        >
                          {(next) => (
                            <span>
                              {t('sequences.nextSend', {
                                time: formatDateTime(next()),
                              })}
                            </span>
                          )}
                        </Show>
                      </p>
                    </div>
                    <EnrollmentStatusBadge
                      status={shownStatus(
                        enrollment,
                        enrollment.sequencePaused
                      )}
                      reason={enrollment.reason}
                    />
                  </li>
                )}
              </For>
            </ul>
          }
        >
          {(failure) => (
            <InlineFailure
              message={failureMessage(failure())}
              retryable={isRetryable(failure())}
              onRetry={() => props.onRetry()}
            />
          )}
        </Show>
      </section>
    </Show>
  );
}
