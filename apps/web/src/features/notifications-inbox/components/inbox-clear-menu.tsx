import { t } from '@app/lib/i18n';
import ChecksIcon from '@icon/system/regular/checks.svg';
import { Dropdown } from '@ui';
import { For } from 'solid-js';
import type { InboxCategory, InboxClearChoice } from '../core/inbox-filters';
import { INBOX_FILTER_GROUPS } from './inbox-filter-groups';

export type InboxClearMenuProps = {
  /** Under Unread, a clear takes unread notifications only. */
  unreadOnly: boolean;
  /** The kinds the filters show; only those can be cleared by kind. */
  isShown: (category: InboxCategory) => boolean;
  onClear: (choice: InboxClearChoice) => void;
};

/** The labels of the clear choices, shared by the menu and the drawer. */
export const clearTodayLabel = (unreadOnly: boolean) =>
  unreadOnly
    ? t('notificationsInbox.clearTodayUnread')
    : t('notificationsInbox.clearToday');
export const clearAllLabel = (unreadOnly: boolean) =>
  unreadOnly
    ? t('notificationsInbox.clearAllUnread')
    : t('notificationsInbox.clearAll');
export const CLEARABLE_KINDS = INBOX_FILTER_GROUPS[0].options;

/** Clear today, clear all, or clear one kind, from the list header. */
export function InboxClearMenu(props: InboxClearMenuProps) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-md"
        aria-label={t('notificationsInbox.clear')}
        tooltip={t('notificationsInbox.clear')}
      >
        <ChecksIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48 max-w-72">
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => props.onClear({ kind: 'today' })}>
            {clearTodayLabel(props.unreadOnly)}
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => props.onClear({ kind: 'all' })}>
            {clearAllLabel(props.unreadOnly)}
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Separator class="my-1 border-t border-edge-divider" />
        <Dropdown.Group>
          <Dropdown.GroupLabel>
            {t('notificationsInbox.clearByKind')}
          </Dropdown.GroupLabel>
          <For each={CLEARABLE_KINDS.filter(({ id }) => props.isShown(id))}>
            {(option) => (
              <Dropdown.Item
                onSelect={() =>
                  props.onClear({ kind: 'category', category: option.id })
                }
              >
                {option.icon?.()}
                <span class="min-w-0 truncate">{option.label}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
