import type { CrmContactEntity } from '@entity';
import { crmContactEmailKey } from '@entity/types/entity';
import { toDate } from 'date-fns';
import type { EntityItem, QuickAccessItem, UserItem } from './types';

function getCrmContactSearchText(contact: CrmContactEntity): string {
  return contact.name === contact.email
    ? contact.email
    : `${contact.name} | ${contact.email}`;
}

/** The Quick Access row for a contact, ordered by its latest interaction. */
export function toCrmContactItem(
  contact: CrmContactEntity
): EntityItem<CrmContactEntity> {
  const lastInteraction = contact.lastInteraction ?? contact.updatedAt;
  return {
    kind: 'entity',
    id: contact.id,
    bucket: 'crm_contact',
    searchText: getCrmContactSearchText(contact),
    sortTimestamp: lastInteraction ? toDate(lastInteraction).getTime() : 0,
    timestamps: { lastInteraction, createdAt: contact.createdAt },
    data: contact,
  };
}

function isCrmContactItem(
  item: QuickAccessItem
): item is EntityItem<CrmContactEntity> {
  return item.kind === 'entity' && item.data.type === 'crm_contact';
}

/** Collapse cached team records while retaining the selected result's ranking. */
export function deduplicateContactItems<T extends QuickAccessItem>(
  items: T[]
): T[] {
  const winners = new Map<string, T>();
  for (const item of items) {
    if (!isCrmContactItem(item) || item.data.hidden) continue;
    const email = crmContactEmailKey(item.data.email);
    const previous = winners.get(email);
    if (
      !previous ||
      item.sortTimestamp > previous.sortTimestamp ||
      (item.sortTimestamp === previous.sortTimestamp && item.id > previous.id)
    ) {
      winners.set(email, item);
    }
  }
  return items.filter(
    (item) =>
      !isCrmContactItem(item) ||
      winners.get(crmContactEmailKey(item.data.email)) === item
  );
}

export type ContactPerson = {
  contact: EntityItem<CrmContactEntity>;
  /** The Macro user with the contact's email, which takes the contact's place. */
  user?: UserItem;
};

/** One entry per visible contact email, paired with its Macro user when the
 * viewer can see one — even when only the contact's CRM name matched. */
export function resolveContactPeople(
  contacts: QuickAccessItem[],
  users: readonly UserItem[]
): ContactPerson[] {
  const usersByEmail = new Map(
    users.map((user) => [crmContactEmailKey(user.data.email), user])
  );
  return deduplicateContactItems(contacts).flatMap((item) =>
    isCrmContactItem(item)
      ? [
          {
            contact: item,
            user: usersByEmail.get(crmContactEmailKey(item.data.email)),
          },
        ]
      : []
  );
}
