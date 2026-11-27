import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import { createFreshSearch, FreshSearchPresets } from '@core/util/freshSort';
import { preserveOrderedWindow } from '@core/util/ordered-window';
import {
  getRecipientOptionFields,
  type RecipientOptionFields,
  rankRecipientMatches,
  uniqueRecipientMatches,
} from './recipient-options';

/** A picker's options as of the last change to its sources. Typing reads
 * these on every keystroke, so each option's fields are read once here. */
export type ListedRecipients = {
  /** Every option, in source order. */
  options: CombinedRecipientItem[];
  /** People the personal source already matched and ordered. */
  personal: CombinedRecipientItem[];
  /** Domain of the sending address; people on it rank higher. */
  senderDomain: string | undefined;
  fields: (option: CombinedRecipientItem) => RecipientOptionFields;
  /** The options ranked for an empty field, ranked when first shown. */
  sorted: () => CombinedRecipientItem[];
};

export function listRecipients(
  options: CombinedRecipientItem[],
  personal: CombinedRecipientItem[],
  senderDomain: string | undefined,
  fields: ReadonlyMap<CombinedRecipientItem, RecipientOptionFields>
): ListedRecipients {
  let sorted: CombinedRecipientItem[] | undefined;
  const listed: ListedRecipients = {
    options,
    personal,
    senderDomain,
    // A typed address or a selected chip may not be listed.
    fields: (option) => fields.get(option) ?? getRecipientOptionFields(option),
    sorted: () => {
      sorted ??= searchRecipients(listed, options, '');
      return sorted;
    },
  };
  return listed;
}

/** Ranks options by name match, recency and brevity. People on the sending
 * domain rank first; while a query is typed, people rank above groups. */
export function searchRecipients(
  listed: ListedRecipients,
  items: CombinedRecipientItem[],
  query: string
): CombinedRecipientItem[] {
  const base = FreshSearchPresets.baseUserSearch<CombinedRecipientItem>(
    () => listed.senderDomain,
    (option) => listed.fields(option).email
  );
  const searching = query.trim().length > 0;
  const search = createFreshSearch<CombinedRecipientItem>({
    config: {
      ...base,
      brevityWeight: 1,
      timeWeight: 1.5,
      boostFn: (item) => {
        const sameDomainBoost = base.boostFn?.(item) ?? 0;
        if (!searching) return sameDomainBoost;

        const personBoost =
          item.kind === 'user' || item.kind === 'contact' ? 0.25 : 0;
        return sameDomainBoost * 0.125 + personBoost;
      },
      useViewedAt: true,
    },
    getName: (option) => listed.fields(option).text,
    isChannelItem: (item) => item.kind === 'channel',
    getTimestamp: (item) => {
      if (item.kind === 'user') {
        return { lastInteraction: item.data.lastInteraction };
      }
      if (item.kind === 'channel') {
        const channel = item.data as typeof item.data & {
          interacted_at?: string | null;
          viewed_at?: string | null;
        };
        return {
          viewedAt: channel.viewed_at,
          updatedAt: channel.interacted_at ?? channel.updated_at,
        };
      }
      return {};
    },
  });
  return search(items, query).map((result) => result.item);
}

/** The suggestions for the field's text: listed options matched and ranked
 * with any typed address. Personal rows keep their window's order, and a
 * selected option keeps the representation its chip shows. */
export function suggestRecipients<T extends CombinedRecipientItem>(
  listed: ListedRecipients,
  query: string,
  typed: CombinedRecipientItem[],
  selected: readonly T[]
): CombinedRecipientItem[] {
  const searched = query
    ? searchRecipients(listed, listed.options, query)
    : listed.sorted();
  return uniqueRecipientMatches<CombinedRecipientItem>(
    preserveOrderedWindow(
      rankRecipientMatches([...searched, ...typed], query, listed.fields),
      listed.personal,
      (option) => listed.fields(option).value
    ),
    selected
  );
}
