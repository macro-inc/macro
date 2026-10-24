import type { ListFilterGroup } from '@app/components/view-shell';
import { match } from 'ts-pattern';
import {
  INBOX_CATEGORIES,
  type InboxCategory,
  type InboxStatus,
} from '../core/inbox-filters';
import type { InboxRowType } from '../core/inbox-row';
import { InboxRowIcon } from './inbox-row-icon';

const categoryLabel = (category: InboxCategory) =>
  match(category)
    .with('mentions', () => 'Mentions')
    .with('replies', () => 'Replies')
    .with('messages', () => 'Messages')
    .with('comments', () => 'Comments')
    .with('email', () => 'Email')
    .with('tasks', () => 'Tasks')
    .with('pull_requests', () => 'Pull requests')
    .with('calendar', () => 'Calendar')
    .with('access', () => 'Access requests')
    .with('agents', () => 'Agents')
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

export type InboxFilterGroupId = 'status' | 'type';
export type InboxFilterOptionId = InboxStatus | InboxCategory;

/** The Status and Type groups, shared by the desktop menu and the touch drawer. */
export const INBOX_FILTER_GROUPS: ListFilterGroup<
  InboxFilterGroupId,
  InboxFilterOptionId
>[] = [
  {
    id: 'status',
    label: 'Status',
    selectionMode: 'single',
    defaultOptionId: 'all',
    options: [
      { id: 'unread', label: 'Unread' },
      { id: 'read', label: 'Read' },
      { id: 'all', label: 'All' },
    ],
  },
  {
    id: 'type',
    label: 'Type',
    options: INBOX_CATEGORIES.map((category) => ({
      id: category,
      label: categoryLabel(category),
      icon: () => (
        <InboxRowIcon
          type={categoryRowType(category)}
          class="size-4 text-ink-muted"
        />
      ),
    })),
  },
];

export const isStatusOption = (id: InboxFilterOptionId): id is InboxStatus =>
  id === 'all' || id === 'unread' || id === 'read';
