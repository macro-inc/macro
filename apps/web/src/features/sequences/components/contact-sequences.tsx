import { formatLocale, t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import type { ContactEnrollment } from '@service-email/generated/schemas';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { shownStatus } from '../core/sequence';
import { EnrollmentStatusBadge } from './status-badge';

/**
 * A contact's sequences, as any teammate sees them: who sends, how it stands,
 * and when. Only the owner can open a sequence; no one sees its emails here.
 */
export function ContactSequences(props: {
  enrollments: readonly ContactEnrollment[];
  failed: boolean;
  ownerName: (ownerId: string) => string;
  onRetry: () => void;
  onOpenSequence: (sequenceId: string) => void;
}) {
  const time = createMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
  );
  const format = (value: string) => time().format(new Date(value));
  return (
    <Show when={props.failed || props.enrollments.length}>
      <section
        class="rounded-xl border border-edge-muted bg-panel/30 p-4"
        aria-label={t('sequences.title')}
      >
        <h3 class="mb-3 text-sm font-medium">{t('sequences.title')}</h3>
        <Show
          when={!props.failed}
          fallback={
            <div
              class="flex items-center gap-2 text-xs text-failure"
              role="alert"
            >
              {t('sequences.contactLoadFailed')}
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => props.onRetry()}
              >
                {t('sequences.retry')}
              </Button>
            </div>
          }
        >
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
                            {t('sequences.lastSent', { time: format(sent()) })}
                          </span>
                        )}
                      </Show>
                      <Show
                        when={
                          shownStatus(enrollment, enrollment.sequencePaused) ===
                            'active' && enrollment.nextSendAt
                        }
                      >
                        {(next) => (
                          <span>
                            {t('sequences.nextSend', { time: format(next()) })}
                          </span>
                        )}
                      </Show>
                    </p>
                  </div>
                  <EnrollmentStatusBadge
                    status={shownStatus(enrollment, enrollment.sequencePaused)}
                    reason={enrollment.reason}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}
