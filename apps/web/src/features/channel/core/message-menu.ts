import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';

export type MessageMenuActionId =
  | 'reply'
  | 'create-task'
  | 'chat'
  | 'ask-macro'
  | 'copy-link'
  | 'copy-message-text'
  | 'edit'
  | 'delete';

type MessageMenuAction = { id: MessageMenuActionId; onClick?: unknown };

const ORDER: Record<MessageMenuActionId, number> = {
  reply: 0,
  'create-task': 1,
  chat: 2,
  'ask-macro': 2,
  'copy-link': 3,
  'copy-message-text': 4,
  edit: 5,
  delete: 6,
};

/** Both message surfaces use the same available actions and semantic order. */
export function messageMenuGroups<T extends MessageMenuAction>(
  actions: readonly T[]
) {
  const available = actions.filter((action) => action.onClick);
  available.sort((a, b) => ORDER[a.id] - ORDER[b.id]);
  return groupMenuItems(available, (action): MenuGroup => {
    if (action.id === 'copy-link' || action.id === 'copy-message-text')
      return 'copy';
    if (action.id === 'edit') return 'modify';
    if (action.id === 'delete') return 'delete';
    return 'most-used';
  });
}
