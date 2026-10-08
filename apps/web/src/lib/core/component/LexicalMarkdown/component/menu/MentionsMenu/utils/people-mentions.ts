import type { EntityItem, UserItem } from '@core/context/quickAccess';
import { resolveContactPeople } from '@core/context/quickAccess/crm-contacts';
import { crmContactEmailKey } from '@entity/types/entity';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';

/** Preserve real user mentions; CRM duplicates retain one navigable team record. */
export function mergePeopleMentions(
  usersAndGroups: (UserItem | GroupMentionItem)[],
  contacts: EntityItem[],
  availableUsers: UserItem[]
): (UserItem | GroupMentionItem | EntityItem)[] {
  const seen = new Set(
    usersAndGroups.flatMap((item) =>
      item.kind === 'user' ? [crmContactEmailKey(item.data.email)] : []
    )
  );
  const result: (UserItem | GroupMentionItem | EntityItem)[] = [
    ...usersAndGroups,
  ];
  for (const { contact, user } of resolveContactPeople(
    contacts,
    availableUsers
  )) {
    const key = crmContactEmailKey(contact.data.email);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(user ?? contact);
  }
  return result;
}
