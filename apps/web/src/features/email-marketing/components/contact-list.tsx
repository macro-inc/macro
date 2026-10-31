import { formatLocale, t } from '@app/lib/i18n';
import { Badge, EmptyStatePanel } from '@ui';
import { isValid } from 'date-fns';
import { For, Show } from 'solid-js';
import type { MarketingContact, Unsubscribe } from '../core/model';

export type ContactRow = {
  contact: MarketingContact;
  sequences: number;
  unsubscribed: boolean;
};

export function ContactList(props: {
  rows: ContactRow[];
  filtered: boolean;
  onOpen: (contact: MarketingContact) => void;
}) {
  return (
    <Show
      when={props.rows.length}
      fallback={
        <EmptyStatePanel
          centered
          title={
            props.filtered
              ? t('emailMarketing.noMatchingContactsTitle')
              : t('emailMarketing.noContacts')
          }
          description={
            props.filtered ? undefined : t('emailMarketing.noContactsHint')
          }
        />
      }
    >
      <ul
        class="flex flex-col px-2 pb-6"
        aria-label={t('emailMarketing.contacts')}
      >
        <For each={props.rows}>
          {(row) => (
            <li>
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-accent touch:min-h-[44px]"
                onClick={() => props.onOpen(row.contact)}
              >
                <span class="ph-no-capture min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {row.contact.name || row.contact.email}
                  </span>
                  <span class="block truncate text-xs text-ink-muted">
                    {row.contact.email}
                  </span>
                </span>
                <Show when={row.unsubscribed}>
                  <Badge variant="outline" size="xs">
                    {t('emailMarketing.unsubscribed')}
                  </Badge>
                </Show>
                <Show when={row.contact.crmContactId}>
                  <Badge variant="secondary" size="xs">
                    {t('emailMarketing.crm')}
                  </Badge>
                </Show>
                <span class="shrink-0 text-xs text-ink-muted">
                  {t('emailMarketing.sequenceCount', { count: row.sequences })}
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

export function UnsubscribedList(props: { entries: Unsubscribe[] }) {
  const date = () =>
    new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium' });
  return (
    <div class="mx-auto w-full max-w-3xl px-4 pb-6">
      <p class="mb-4 text-xs text-ink-muted">
        {t('emailMarketing.unsubscribedHint')}
      </p>
      <Show
        when={props.entries.length}
        fallback={
          <EmptyStatePanel
            centered
            class="h-auto py-10"
            title={t('emailMarketing.noUnsubscribes')}
          />
        }
      >
        <ul
          class="divide-y divide-edge-muted rounded-xl border border-edge-muted"
          aria-label={t('emailMarketing.unsubscribedSection')}
        >
          <For
            each={[...props.entries].sort((a, b) =>
              b.unsubscribedAt.localeCompare(a.unsubscribedAt)
            )}
          >
            {(entry) => (
              <li class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span class="ph-no-capture min-w-0 truncate">
                  {entry.email}
                </span>
                {/* A record edited in the database can hold any text as a date. */}
                <Show when={isValid(new Date(entry.unsubscribedAt))}>
                  <span class="shrink-0 text-xs text-ink-muted">
                    {date().format(new Date(entry.unsubscribedAt))}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
