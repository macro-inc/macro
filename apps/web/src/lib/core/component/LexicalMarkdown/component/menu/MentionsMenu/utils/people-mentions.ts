import type { EntityItem, UserItem } from '@core/context/quickAccess';
import { deduplicateContactItems } from '@core/context/quickAccess/entity-search';
import type { CrmContactEntity } from '@entity';
import type { GroupMentionItem } from '../../../../utils/mentionsUtils';

const emailKey = (email: string) => email.trim().toLowerCase();

/** Preserve real user mentions; CRM duplicates retain one navigable team record. */
export function mergePeopleMentions(
  usersAndGroups: (UserItem | GroupMentionItem)[],
  contacts: EntityItem[],
  availableUsers: UserItem[]
): (UserItem | GroupMentionItem | EntityItem)[] {
  const usersByEmail = new Map(
    availableUsers.map((user) => [emailKey(user.data.email), user])
  );
  const seen = new Set(
    usersAndGroups.flatMap((item) =>
      item.kind === 'user' ? [emailKey(item.data.email)] : []
    )
  );
  const result: (UserItem | GroupMentionItem | EntityItem)[] = [
    ...usersAndGroups,
  ];
  const ordered = deduplicateContactItems(contacts).filter(
    (item) => item.data.type === 'crm_contact'
  );
  for (const contact of ordered) {
    const key = emailKey((contact.data as CrmContactEntity).email);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(usersByEmail.get(key) ?? contact);
  }
  return result;
}
