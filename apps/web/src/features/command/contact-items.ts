import type {
  EntityItem,
  QuickAccessItem,
  UserItem,
} from '@core/context/quickAccess';
import {
  resolveContactPeople,
  toCrmContactItem,
} from '@core/context/quickAccess/crm-contacts';
import type { CrmContactEntity } from '@entity';

function directMessagesByUser(
  directMessages: readonly QuickAccessItem[],
  viewerId: string | undefined
) {
  const byUser = new Map<string, EntityItem>();
  for (const item of directMessages) {
    if (item.kind !== 'entity' || item.data.type !== 'channel') continue;
    if (item.data.channelType !== 'direct_message') continue;
    const others = (item.data.participantIds ?? []).filter(
      (id) => id !== viewerId
    );
    if (others.length === 1) byUser.set(others[0], item);
  }
  return byUser;
}

/**
 * One People row per discovered contact email. A contact who is a Macro user
 * becomes that person's direct message: the existing conversation when the
 * viewer has one, else the user, whose selection opens one. The contact's
 * name stays searchable on that row so a CRM-only alias still ranks it.
 */
export function contactCommandItems(options: {
  contacts: readonly CrmContactEntity[];
  users: readonly UserItem[];
  directMessages: readonly QuickAccessItem[];
  viewerId: string | undefined;
}): (EntityItem | UserItem)[] {
  const conversations = directMessagesByUser(
    options.directMessages,
    options.viewerId
  );
  return resolveContactPeople(
    options.contacts.map(toCrmContactItem),
    options.users
  ).map(({ contact, user }) => {
    if (!user) return contact;
    const conversation = conversations.get(user.id) ?? user;
    return {
      ...conversation,
      searchText: `${conversation.searchText} | ${contact.searchText}`,
    };
  });
}
