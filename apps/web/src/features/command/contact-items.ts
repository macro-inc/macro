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
import type { CommandMenuItem } from './useCommandItems';

function directMessageRecipient(
  item: CommandMenuItem,
  viewerId: string | undefined
) {
  if (item.kind !== 'entity' || item.data.type !== 'channel') return;
  if (item.data.channelType !== 'direct_message') return;
  const others = (item.data.participantIds ?? []).filter(
    (id) => id !== viewerId
  );
  return others.length === 1 ? others[0] : undefined;
}

/** A person keeps their search position when opening them creates a DM. */
export function commandSearchResultKey(
  item: CommandMenuItem,
  viewerId: string | undefined
): string {
  return directMessageRecipient(item, viewerId) ?? item.id;
}

function directMessagesByUser(
  directMessages: readonly QuickAccessItem[],
  viewerId: string | undefined
) {
  const byUser = new Map<string, EntityItem>();
  for (const item of directMessages) {
    if (item.kind !== 'entity' || item.data.type !== 'channel') continue;
    const recipient = directMessageRecipient(item, viewerId);
    if (recipient) byUser.set(recipient, item);
  }
  return byUser;
}

/** Resolve person matches to one conversation row, retaining names and emails. */
export function mergeCommandPeople<T extends CommandMenuItem>(
  items: readonly T[],
  directMessages: readonly QuickAccessItem[],
  viewerId: string | undefined
): (T | EntityItem)[] {
  const conversations = directMessagesByUser(directMessages, viewerId);
  const merged = new Map<string, T | EntityItem>();
  for (const item of items) {
    if (item.kind === 'user' && item.id === viewerId) continue;
    const conversation =
      item.kind === 'user' ? conversations.get(item.id) : undefined;
    const resolved = conversation
      ? {
          ...conversation,
          searchText: `${conversation.searchText} | ${item.searchText}`,
        }
      : item;
    const previous = merged.get(resolved.id);
    merged.set(
      resolved.id,
      previous
        ? {
            ...resolved,
            searchText: `${previous.searchText} | ${resolved.searchText}`,
          }
        : resolved
    );
  }
  return [...merged.values()];
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
  const matches = resolveContactPeople(
    options.contacts.map(toCrmContactItem),
    options.users
  ).map(({ contact, user }) => {
    if (!user) return contact;
    return {
      ...user,
      searchText: `${user.searchText} | ${contact.searchText}`,
    };
  });
  return mergeCommandPeople(matches, options.directMessages, options.viewerId);
}
