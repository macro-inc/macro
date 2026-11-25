import type { SearchTip } from '@app/components/view-shell/search-tips';
import { t } from '@app/lib/i18n';

/** The operators the Search view's tips list, each with what it finds. */
export const searchViewTips = (): SearchTip[] => [
  { operator: 'type:task', finds: t('searchOperators.wordTasks') },
  {
    operator: 'from:ana',
    finds: t('searchOperators.fromPerson', { name: 'Ana' }),
  },
  { operator: 'assignee:me', finds: t('searchOperators.tipAssignedToYou') },
  { operator: 'status:in_progress', finds: t('searchOperators.tipInProgress') },
  {
    operator: 'tag:finance',
    finds: t('searchOperators.tipTagged', { name: 'Finance' }),
  },
  { operator: 'is:unread', finds: t('searchOperators.wordUnread') },
  {
    operator: '"q3 plan"',
    finds: t('searchOperators.tipPhrase', { words: 'q3 plan' }),
  },
  {
    operator: '-draft',
    finds: t('searchOperators.tipLeaveOut', { words: 'draft' }),
  },
];
