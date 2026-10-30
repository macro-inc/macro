import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { AttentionReason, Enrollment } from '../core/model';
import { AttentionBadge, StatusBadge } from './status-badge';

export function ContactEnrollments(props: {
  entries: Enrollment[];
  loading?: boolean;
  error?: string;
  unsubscribed?: boolean;
  onOpen?: () => void;
  /** A problem to show instead of the stored status, when the host knows one. */
  attention?: (entry: Enrollment) => AttentionReason | undefined;
}) {
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
      <Show
        when={!props.error && !props.loading}
        fallback={
          <Show when={props.loading}>
            <ListSkeleton.Root label={t('emailMarketing.loadingEnrollments')}>
              <ListSkeleton.Row>
                <ListSkeleton.Bar class="h-3 w-1/2" />
              </ListSkeleton.Row>
            </ListSkeleton.Root>
          </Show>
        }
      >
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
                    <p class="truncate text-sm">{entry.campaignName}</p>
                    <p class="text-xs text-ink-muted">
                      {t('emailMarketing.scheduledEmails', {
                        count: entry.steps.filter(
                          (step) => step.status === 'queued'
                        ).length,
                      })}
                    </p>
                  </div>
                  <Show
                    when={props.attention?.(entry)}
                    fallback={<StatusBadge status={entry.status} />}
                  >
                    {(reason) => <AttentionBadge reason={reason()} />}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
