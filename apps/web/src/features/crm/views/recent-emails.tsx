import { t } from '@app/lib/i18n';
import type { CrmCompanyEntity } from '@entity';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { createMemo, createSignal, Show } from 'solid-js';
import type { ItemListSource } from '../context/crm-sources';
import { RecordItemList } from './record-item-list';
import { useCompanyEmailsQuery, useContactEmailsQuery } from './use-crm';

const PREVIEW_COUNT = 5;

function RecentEmails(props: {
  source: ItemListSource;
  onViewAll?: () => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const count = () => props.source.data?.entities.length ?? 0;
  const show = () =>
    props.source.isEnabled &&
    (props.source.isPending || props.source.isError || count() > 0);

  return (
    <Show when={show()}>
      <section
        class="flex flex-col gap-2"
        aria-label={t('crmRecord.recentEmails')}
      >
        <div class="flex items-center justify-between gap-3">
          <button
            type="button"
            class="flex min-w-0 items-center gap-1"
            aria-expanded={expanded()}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded() ? (
              <CaretDownIcon class="size-3" />
            ) : (
              <CaretRightIcon class="size-3" />
            )}
            <span class="text-xs">{t('crmRecord.recentEmails')}</span>
          </button>
          <Show when={props.onViewAll && count() > 0}>
            <button
              type="button"
              class="shrink-0 text-xs text-accent"
              onClick={() => props.onViewAll?.()}
            >
              {t('crmRecord.viewAll')}
            </button>
          </Show>
        </div>
        <Show when={expanded()}>
          <RecordItemList source={props.source} limit={PREVIEW_COUNT} />
        </Show>
      </section>
    </Show>
  );
}

/** The newest emails with one person, above the discussion. */
export function ContactRecentEmails(props: {
  email?: string;
  onViewAll?: () => void;
}) {
  const source = useContactEmailsQuery(
    () => props.email,
    () => 'team',
    () => 'all'
  );
  return <RecentEmails source={source} onViewAll={props.onViewAll} />;
}

/** The newest emails with a company, above the discussion. */
export function CompanyRecentEmails(props: {
  company?: CrmCompanyEntity;
  onViewAll?: () => void;
}) {
  const domains = createMemo(
    () => props.company?.domains.map((domain) => domain.domain) ?? []
  );
  const source = useCompanyEmailsQuery(
    domains,
    () => 'team',
    () => 'all'
  );
  return <RecentEmails source={source} onViewAll={props.onViewAll} />;
}
