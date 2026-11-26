import {
  type SearchTip,
  SearchTipsButton,
} from '@app/components/view-shell/search-tips';
import { EMAIL_SEARCH_DOCS_URL } from '@app/constants/docs-links';
import { t } from '@app/lib/i18n';

/** A few operators, each written out as an example with what it finds. */
export const emailSearchTips = (): SearchTip[] => [
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

/**
 * The info button beside Mail's title while its search is open: hovering it
 * lists the operators, and pressing it opens the full list on the docs site.
 */
export function EmailSearchTipsButton() {
  return (
    <SearchTipsButton
      tips={emailSearchTips()}
      docsUrl={EMAIL_SEARCH_DOCS_URL}
    />
  );
}
