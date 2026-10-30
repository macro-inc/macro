import { t } from '@app/lib/i18n';
import { For, Show } from 'solid-js';
import type { Sender } from '../core/model';

/** The Gmail inboxes sequences can send from, and how sending works. */
export function DeliveryPanel(props: { senders: Sender[] }) {
  return (
    <div class="mx-auto w-full max-w-3xl space-y-4 px-4 pb-6">
      <section class="rounded-xl border border-edge-muted p-5">
        <h3 class="text-sm font-medium">
          {t('emailMarketing.connectedGmail')}
        </h3>
        <p class="mt-1 text-xs leading-5 text-ink-muted">
          {t('emailMarketing.connectedGmailHint')}
        </p>
        <ul class="mt-4 space-y-2" aria-label={t('emailMarketing.inboxes')}>
          <For each={props.senders}>
            {(sender) => (
              <li class="flex items-center justify-between gap-3 rounded-lg bg-panel/50 px-4 py-3">
                <span class="min-w-0 truncate text-sm">{sender.email}</span>
                <span class="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                  <span
                    class="size-1.5 rounded-full"
                    classList={{
                      'bg-success': sender.ready,
                      'bg-warning': !sender.ready,
                    }}
                    aria-hidden="true"
                  />
                  {sender.ready
                    ? t('emailMarketing.inboxConnected')
                    : t('emailMarketing.inboxReconnect')}
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={!props.senders.length}>
          <p class="mt-4 rounded-lg bg-panel p-4 text-sm text-ink-muted">
            {t('emailMarketing.noInboxes')}
          </p>
        </Show>
      </section>
      <section class="rounded-xl border border-edge-muted p-5">
        <h3 class="text-sm font-medium">
          {t('emailMarketing.howSendingWorks')}
        </h3>
        <ul class="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-ink-muted">
          <li>{t('emailMarketing.howSendingScheduled')}</li>
          <li>{t('emailMarketing.howSendingLimits')}</li>
          <li>{t('emailMarketing.howSendingReplies')}</li>
        </ul>
      </section>
    </div>
  );
}
