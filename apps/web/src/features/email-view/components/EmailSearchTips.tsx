import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import { EMAIL_SEARCH_DOCS_URL } from '@app/constants/docs-links';
import { t } from '@app/lib/i18n';
import { openExternalUrl } from '@core/util/url';
import ExternalIcon from '@icon/system/regular/arrow-square-out.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import { buttonClasses, cn, HoverCard } from '@ui';
import { For } from 'solid-js';

/** A few operators, each written out as an example with what it finds. */
const emailSearchTips = () => [
  {
    operator: 'from:ana',
    finds: t('emailViews.searchFromPerson', { name: 'Ana' }),
  },
  {
    operator: 'to:ben',
    finds: t('emailViews.searchToPerson', { name: 'Ben' }),
  },
  {
    operator: 'subject:lunch',
    finds: t('emailViews.searchTipSubject', { words: 'lunch' }),
  },
  {
    operator: '"team lunch"',
    finds: t('emailViews.searchTipPhrase', { words: 'team lunch' }),
  },
  { operator: 'is:unread', finds: t('emailViews.searchWordUnread') },
  { operator: 'has:attachment', finds: t('emailViews.searchWordAttachment') },
  { operator: 'in:sent', finds: t('emailViews.searchWordSent') },
  { operator: 'newer_than:7d', finds: t('emailViews.searchWordThisWeek') },
  {
    operator: '-newsletter',
    finds: t('emailViews.searchTipLeaveOut', { words: 'newsletter' }),
  },
];

/** The operators Mail's search reads most, beside what each one finds. */
export function EmailSearchTipList(props: { class?: string }) {
  return (
    <dl
      class={cn(
        'grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2',
        props.class
      )}
    >
      <For each={emailSearchTips()}>
        {(tip) => (
          <>
            <dt class="whitespace-pre font-mono text-xs touch:text-sm">
              <SearchOperatorText
                parts={[{ text: tip.operator, operator: true }]}
              />
            </dt>
            <dd class="min-w-0 text-ink">{tip.finds}</dd>
          </>
        )}
      </For>
    </dl>
  );
}

/** Opens the docs page that lists every operator Mail's search reads. */
export function openEmailSearchDocs() {
  openExternalUrl(EMAIL_SEARCH_DOCS_URL);
}

/** The full list of operators, on the docs site. */
export function EmailSearchDocsLink(props: { class?: string }) {
  return (
    <button
      type="button"
      class={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink not-touch:hover:bg-hover',
        props.class
      )}
      onClick={openEmailSearchDocs}
    >
      <ExternalIcon aria-hidden="true" class="size-4 shrink-0" />
      {t('emailViews.searchAllOperators')}
    </button>
  );
}

/**
 * The info button beside Mail's title while its search is open: hovering it
 * lists the operators, and pressing it opens the full list on the docs site.
 */
export function EmailSearchTipsButton() {
  return (
    <HoverCard
      as="button"
      triggerAriaLabel={t('emailViews.searchTips')}
      triggerOnClick={openEmailSearchDocs}
      triggerClass={buttonClasses({ variant: 'ghost', size: 'icon-sm' })}
      placement="bottom-start"
      contentClass="flex-col items-stretch p-3 text-sm text-ink"
      content={
        <div class="flex w-max max-w-[min(360px,calc(100vw-32px))] flex-col">
          <EmailSearchTipList class="px-2" />
          <div class="my-2 border-t border-edge-muted" />
          <EmailSearchDocsLink />
        </div>
      }
    >
      <InfoIcon aria-hidden="true" class="size-3.5 shrink-0" />
    </HoverCard>
  );
}
