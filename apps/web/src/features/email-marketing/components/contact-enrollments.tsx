import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { AttentionReason, Enrollment, QueuedStep } from '../core/model';
import { EnrollmentBadge } from './status-badge';

export function ContactEnrollments(props: {
  entries: Enrollment[];
  loading?: boolean;
  error?: string;
  unsubscribed?: boolean;
  onOpen?: () => void;
  /** A problem to show instead of the stored status, when the host knows one. */
  attention?: (entry: Enrollment) => AttentionReason | undefined;
  /** Steps known sent; without a scheduler read, the ones handed to Gmail. */
  sentSteps?: (entry: Enrollment) => number | undefined;
  /** A scheduled enrollment with nothing left to send. */
  isFinished?: (entry: Enrollment) => boolean;
}) {
  const count = (entry: Enrollment, status: QueuedStep['status']) =>
    entry.steps.filter((step) => step.status === status).length;
  /** Steps handed to the scheduler and not sent yet. */
  const scheduled = (entry: Enrollment) =>
    count(entry, 'queued') +
    count(entry, 'delivery_started') -
    (props.sentSteps?.(entry) ?? count(entry, 'delivery_started'));
  return (
    <section
      class="rounded-xl border border-edge-muted bg-panel/30 p-4"
      aria-label={t('emailMarketing.contactEnrollments')}
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-sm font-medium">{t('nav.emailMarketing')}</h3>
        <Show when={props.onOpen}>
          {(open) => (
            <Button type="button" variant="link" size="xs" onClick={open()}>
              {t('emailMarketing.openModule')}
            </Button>
          )}
        </Show>
      </div>
      <Show when={props.unsubscribed}>
        <p class="mb-2 text-xs text-ink-muted">
          {t('emailMarketing.contactUnsubscribed')}
        </p>
      </Show>
      <Show when={props.error}>
        <p class="text-xs text-failure" role="alert">
          {props.error}
        </p>
      </Show>
      <Switch>
        <Match when={props.loading}>
          <ListSkeleton.Root label={t('emailMarketing.loadingEnrollments')}>
            <ListSkeleton.Row>
              <ListSkeleton.Bar class="h-3 w-1/2" />
            </ListSkeleton.Row>
          </ListSkeleton.Root>
        </Match>
        <Match when={!props.error}>
          <Show
            when={props.entries.length}
            fallback={
              <p class="text-xs text-ink-muted">
                {t('emailMarketing.notEnrolled')}
              </p>
            }
          >
            <ul class="flex flex-col gap-2">
              <For each={props.entries}>
                {(entry) => (
                  <li class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="ph-no-capture truncate text-sm">
                        {entry.campaignName}
                      </p>
                      <p class="text-xs text-ink-muted">
                        {t('emailMarketing.scheduledEmails', {
                          count: scheduled(entry),
                        })}
                      </p>
                    </div>
                    <EnrollmentBadge
                      status={entry.status}
                      finished={props.isFinished?.(entry)}
                      attention={props.attention?.(entry)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Match>
      </Switch>
    </section>
  );
}
