import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { InlineFailure } from '../components/failure';
import { EnrollmentStatusBadge, SendTimes } from '../components/status';
import { useSequences } from '../context/sequences-context';
import { shownStatus } from '../core/sequence';

/**
 * A contact's sequences, as any teammate sees them: who sends, how it stands,
 * and when. Only the owner can open a sequence.
 */
export function ContactSequencesView(props: {
  contactId: string;
  onOpenSequence: (sequenceId: string) => void;
}) {
  const context = useSequences();
  const source = context.createContactEnrollments(() => props.contactId);
  return (
    <Show when={source.failure() || source.enrollments().length}>
      <section
        class="rounded-xl border border-edge-muted bg-panel/30 p-4"
        aria-label={t('sequences.title')}
      >
        <h3 class="mb-3 text-sm font-medium">{t('sequences.title')}</h3>
        <Show
          when={source.failure()}
          fallback={
            <ul class="flex flex-col gap-3">
              <For each={source.enrollments()}>
                {(enrollment) => {
                  const status = () =>
                    shownStatus(enrollment, enrollment.sequencePaused);
                  return (
                    <li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div class="min-w-0 space-y-1">
                        <Show
                          when={enrollment.ownerId === context.userId()}
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
                              {context.userName(enrollment.ownerId)}
                            </span>
                          </span>
                          <SendTimes
                            lastSentAt={enrollment.lastSentAt}
                            nextSendAt={enrollment.nextSendAt}
                            sending={status() === 'active'}
                          />
                        </p>
                      </div>
                      <EnrollmentStatusBadge
                        status={status()}
                        reason={enrollment.reason}
                      />
                    </li>
                  );
                }}
              </For>
            </ul>
          }
        >
          {(failure) => (
            <InlineFailure
              failure={failure()}
              onRetry={() =>
                fireAndForget(source.refresh(), 'sequences.contact')
              }
            />
          )}
        </Show>
      </section>
    </Show>
  );
}
