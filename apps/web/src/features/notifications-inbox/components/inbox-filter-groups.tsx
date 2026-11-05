import type { ListFilterGroup } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import { INBOX_CATEGORIES, type InboxCategory } from '../core/inbox-filters';
import type { InboxRowType } from '../core/inbox-row';
import { InboxRowIcon } from './inbox-row-icon';

const categoryLabel = (category: InboxCategory) =>
  match(category)
    .with('mentions', () => t('notificationsInbox.categoryMentions'))
    .with('replies', () => t('notificationsInbox.categoryReplies'))
    .with('messages', () => t('notificationsInbox.categoryMessages'))
    .with('comments', () => t('notificationsInbox.categoryComments'))
    .with('email', () => t('notificationsInbox.categoryEmail'))
    .with('tasks', () => t('notificationsInbox.categoryTasks'))
    .with('pull_requests', () => t('notificationsInbox.categoryPullRequests'))
    .with('calendar', () => t('notificationsInbox.categoryCalendar'))
    .with('access', () => t('notificationsInbox.categoryAccess'))
    .with('agents', () => t('notificationsInbox.categoryAgents'))
    .exhaustive();

/** The glyph a category's rows show. */
const categoryRowType = (category: InboxCategory): InboxRowType =>
  match(category)
    .with('mentions', () => 'channel_mention' as const)
    .with('replies', () => 'channel_thread' as const)
    .with('messages', () => 'channel_messages' as const)
    .with('comments', () => 'discussion_messages' as const)
    .with('email', () => 'email' as const)
    .with('tasks', () => 'task' as const)
    .with('pull_requests', () => 'pull_request' as const)
    .with('calendar', () => 'calendar_event' as const)
    .with('access', () => 'access_requested' as const)
    .with('agents', () => 'agent' as const)
    .exhaustive();

export type InboxFilterGroupId = 'type';
export type InboxFilterOptionId = InboxCategory;

/**
 * The Type group, shared by the desktop menu and the touch drawer. Labels are
 * getters so a module constant follows the interface language.
 */
export const INBOX_FILTER_GROUPS: ListFilterGroup<
  InboxFilterGroupId,
  InboxFilterOptionId
>[] = [
  {
    id: 'type',
    get label() {
      return t('notificationsInbox.type');
    },
    options: INBOX_CATEGORIES.map((category) => ({
      id: category,
      get label() {
        return categoryLabel(category);
      },
      icon: () => (
        <InboxRowIcon
          type={categoryRowType(category)}
          class="size-4 text-ink-muted"
        />
      ),
    })),
  },
];
