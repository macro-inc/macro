import { toEmailSearchPeople } from '@app/features/email-view/queries/use-email-search-values';
import type { SearchOperatorValues } from '@app/features/next-soup/core/search-operator-completions';
import { useQuickAccess } from '@core/context/quickAccess';
import { useTagOptionSummaries } from '@property/tags/tag-sets-context';
import { useContactRecipientSource } from '@queries/contacts/recipient-source';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';

/** Who an operator being typed names, by the value typed so far. */
export type SearchOperatorPersonTyping = Accessor<string | undefined>;

/**
 * What the Search field offers as operator values: people as the composer's
 * recipient picker finds and ranks them, read only while `person` gives the
 * value being typed after `assignee:`, `author:` or `from:`; the caller's tag
 * names, inbox addresses and named channels.
 */
export function createSearchOperatorValues(
  person: SearchOperatorPersonTyping
): Accessor<SearchOperatorValues> {
  const namesPerson = () => person() !== undefined;
  const recipients = useContactRecipientSource({
    search: () => person() ?? '',
    enabled: namesPerson,
    selfId: () => undefined,
    senderDomain: () => undefined,
    includeSelf: () => false,
  });
  const tags = useTagOptionSummaries();
  const linksQuery = useMailAccountsQuery();
  const channels = useQuickAccess().useList('channel').items;

  return createMemo(() => ({
    people: namesPerson() ? toEmailSearchPeople(recipients.items()) : [],
    tags: tags().map((tag) => tag.label),
    inboxes: (queryReadyGate(linksQuery) ? linksQuery.data.links : []).map(
      (link) => link.email_address
    ),
    channels: channels()
      .map((channel) => channel.data.name)
      .filter((name): name is string => Boolean(name)),
  }));
}
