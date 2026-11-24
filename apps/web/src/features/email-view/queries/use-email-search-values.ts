import { listTagOptions } from '@property/tags/list-tag-options';
import { useTagSets } from '@property/tags/tag-sets-context';
import { useContactRecipientSource } from '@queries/contacts/recipient-source';
import { useEmailUserLabelsQuery } from '@queries/email/labels';
import { ApiLabelType } from '@service-email/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';
import { emailSearchValueBeingTyped } from '../search/create-email-search-suggestions';
import {
  canMailAddress,
  type EmailSearchLabel,
  type EmailSearchPerson,
} from '../search/email-search-operators';

/**
 * The people and labels Mail's search field offers after an operator that
 * names them (`from:an`, `label:trav`). Each is read only while such an
 * operator is being typed: people as the composer's recipient picker finds
 * and ranks them, labels as the person's tags and their inboxes' own labels.
 */
export function useEmailSearchValues(search: Accessor<string>): {
  people: Accessor<EmailSearchPerson[]>;
  labels: Accessor<EmailSearchLabel[]>;
} {
  const typing = createMemo(() => emailSearchValueBeingTyped(search()));
  const namesPerson = () => typing()?.kind === 'person';
  const namesLabel = () => typing()?.kind === 'label';

  const recipients = useContactRecipientSource({
    search: () => (namesPerson() ? (typing()?.value ?? '') : ''),
    enabled: namesPerson,
    selfId: () => undefined,
    senderDomain: () => undefined,
    includeSelf: () => true,
  });
  const people = createMemo((): EmailSearchPerson[] => {
    if (!namesPerson()) return [];
    const seen = new Set<string>();
    return recipients.items().flatMap((user) => {
      const email = user.data.email.trim().toLowerCase();
      if (seen.has(email) || !canMailAddress(email)) return [];
      seen.add(email);
      const name = user.data.name?.trim();
      return [
        { id: user.id, email, name: name && name !== email ? name : undefined },
      ];
    });
  });

  const mailboxLabels = useEmailUserLabelsQuery(namesLabel);
  const tagSets = useTagSets();
  const labels = createMemo((): EmailSearchLabel[] => {
    if (!namesLabel()) return [];
    const tags = listTagOptions(tagSets()).map(
      (tag): EmailSearchLabel => ({ name: tag.label, kind: 'tag' })
    );
    // System labels (Inbox, Sent, Unread) are Mail's views and states.
    const own = mailboxLabels.isSuccess
      ? mailboxLabels.data.labels
          .filter((label) => label.type === ApiLabelType.User)
          .map(
            (label): EmailSearchLabel => ({ name: label.name, kind: 'label' })
          )
      : [];
    return [...tags, ...own];
  });

  return { people, labels };
}
