import { useContactReferences } from '@queries/contacts/use-references';
import { type Accessor, createMemo } from 'solid-js';
import type { InputFields, Intent } from '../core/input';
import { inputPeopleTerms } from '../core/people-terms';
import {
  messageRecipientChoices,
  type Recipient,
  type RecipientLookup,
} from '../core/recipients';

/** Suggestions and inference have different contracts: this returns complete
 * per-label witnesses, never a merged people pool or a partial suggestion page. */
export function useInputPeople(
  fields: Accessor<InputFields>,
  intent: Accessor<Intent | undefined>,
  channels: Accessor<readonly Recipient[]>
) {
  const labels = createMemo(
    () => {
      const current = intent();
      const ids = new Set(
        current === 'message'
          ? channels().map((channel) => channel.id.toLowerCase())
          : []
      );
      return inputPeopleTerms(fields(), current).filter(
        (term) => !ids.has(term)
      );
    },
    undefined,
    {
      equals: (previous, next) =>
        previous.length === next.length &&
        previous.every((term, index) => term === next[index]),
    }
  );
  const source = useContactReferences(() => ({
    labels: labels(),
    matching: 'preferFullName',
    excludeSecondaryInboxes: true,
  }));
  const lookup: RecipientLookup = (term) =>
    source.lookup(term)?.map(
      (person): Recipient => ({
        id: person.userId,
        email: person.email,
        label: person.name || person.email,
        kind: 'user',
      })
    );
  const destinations: RecipientLookup = (term) =>
    messageRecipientChoices(term, lookup, channels());
  return {
    lookup,
    destinations,
    loading: source.loading,
    error: source.error,
    retry: source.retry,
  };
}
