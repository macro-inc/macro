import { groupMenuItems, type MenuGroup } from '@core/menu/group-menu-items';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';

type SoupMenuAction = {
  id: string;
  destructive?: boolean;
  group?: MenuGroup;
};

const ACTION_GROUPS: Record<string, MenuGroup> = {
  'open-in-split': 'open',
  'open-in-tab': 'open',
  'open-on-github': 'open',
  'copy-link': 'copy',
  'copy-branch-name': 'copy',
  'copy-entity-id': 'copy',
  'copy-github-link': 'copy',
  delete: 'delete',
  'remove-from-folder': 'delete',
  download: 'share-export',
  share: 'share-export',
  favorite: 'state',
  'mark-done': 'state',
  'mark-not-done': 'state',
  'mark-read': 'state',
  'mark-unread': 'state',
  'mark-notifications-read': 'state',
  'create-reminder': 'state',
  mute: 'state',
  'notification-settings': 'state',
  'archive-session': 'state',
  'hide-company': 'state',
  'sender-signal': 'state',
  'sender-noise': 'state',
  'block-sender': 'state',
};

const MOST_USED: Record<string, readonly string[]> = {
  document: ['ask-macro', 'share', 'favorite'],
  project: ['share', 'favorite'],
  initiative: ['share', 'favorite'],
  channel: ['favorite', 'mark-notifications-read', 'ask-macro'],
  email: [
    'mark-done',
    'mark-not-done',
    'mark-read',
    'mark-unread',
    'create-reminder',
  ],
  call: ['share', 'favorite'],
};

const TASK_MOST_USED = [
  'mark-done',
  'mark-not-done',
  'set-assignee',
  `set-${SYSTEM_PROPERTY_IDS.ASSIGNEES}`,
  'share',
];

/** Classify only available actions; retain live metadata and handler identity. */
export function groupSoupEntityActions<T extends SoupMenuAction>(
  items: readonly T[],
  entity?: { type: string },
  isTask = false
) {
  const mostUsed = isTask
    ? TASK_MOST_USED
    : (MOST_USED[entity?.type ?? ''] ?? []);
  return groupMenuItems(items, (item): MenuGroup => {
    if (item.destructive) return 'delete';
    if (item.group) return item.group;
    if (mostUsed.includes(item.id)) return 'most-used';
    // Property edits include generated task IDs and CRM field names.
    return ACTION_GROUPS[item.id] ?? 'modify';
  });
}
