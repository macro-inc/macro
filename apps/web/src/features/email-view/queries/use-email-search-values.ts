import { useTagOptionSummaries } from '@property/tags/tag-sets-context';
import { useContactRecipientSource } from '@queries/contacts/recipient-source';
import { useEmailUserLabelsQuery } from '@queries/email/labels';
import { queryReadyGate } from '@queries/gate';
import { ApiLabelType } from '@service-email/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';
import { emailSearchValueBeingTyped } from '../search/create-email-search-suggestions';
import {
  canMailAddress,
  type EmailSearchLabel,
  type EmailSearchPerson,
} from '../search/email-search-operators';

type RecipientUser = {
  id: string;
  data: { email: string; name?: string | null };
};

/**
 * The people to list, in the order given: each address once, only those mail
 * can reach, and a name only when it says more than the address.
 */
export function toEmailSearchPeople(
  users: readonly RecipientUser[]
): EmailSearchPerson[] {
  const seen = new Set<string>();
  return users.flatMap((user) => {
    const email = user.data.email.trim().toLowerCase();
    if (seen.has(email) || !canMailAddress(email)) return [];
    seen.add(email);
    const name = user.data.name?.trim();
    return [
      { id: user.id, email, name: name && name !== email ? name : undefined },
    ];
  });
}

/**
 * The person's tags, then their inboxes' own labels. A provider's system
 * labels (Gmail's Inbox, Sent, Unread, Important and categories) are left
 * out: Mail names those as views, states and its own sorting.
 */
export function toEmailSearchLabels(
  tags: readonly { label: string }[],
  labels: readonly { name: string; type: string }[]
): EmailSearchLabel[] {
  return [
    ...tags.map((tag): EmailSearchLabel => ({ name: tag.label, kind: 'tag' })),
    ...labels
      .filter((label) => label.type === ApiLabelType.User)
      .map((label): EmailSearchLabel => ({ name: label.name, kind: 'label' })),
  ];
}

/**
 * The people and labels Mail's search field offers after an operator that
 * names them (`from:an`, `label:trav`). Each is read only while the field is
 * `active` (open and focused) and such an operator is being typed: people as
 * the composer's recipient picker finds and ranks them, labels as the
 * person's tags and their inboxes' own labels.
 */
export function useEmailSearchValues(
  search: Accessor<string>,
  active: Accessor<boolean>
): {
  people: Accessor<EmailSearchPerson[]>;
  labels: Accessor<EmailSearchLabel[]>;
} {
  const typing = createMemo(() =>
    active() ? emailSearchValueBeingTyped(search()) : undefined
  );
  const namesPerson = () => typing()?.kind === 'person';
  const namesLabel = () => typing()?.kind === 'label';

  const recipients = useContactRecipientSource({
    search: () => (namesPerson() ? (typing()?.value ?? '') : ''),
    enabled: namesPerson,
    selfId: () => undefined,
    senderDomain: () => undefined,
    includeSelf: () => true,
  });
  const people = createMemo((): EmailSearchPerson[] =>
    namesPerson() ? toEmailSearchPeople(recipients.items()) : []
  );

  const mailboxLabels = useEmailUserLabelsQuery(namesLabel);
  const tags = useTagOptionSummaries();
  const labels = createMemo((): EmailSearchLabel[] => {
    if (!namesLabel()) return [];
    const own = queryReadyGate(mailboxLabels) ? mailboxLabels.data.labels : [];
    return toEmailSearchLabels(tags(), own);
  });

  return { people, labels };
}
