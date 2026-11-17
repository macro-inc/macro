import type { Accessor } from 'solid-js';
import type {
  CombinedRecipientItem,
  CombinedRecipientKind,
} from './combinedRecipient';

/** One picker owns one replaceable page; selected chips belong to its caller. */
export type RecipientSource<K extends CombinedRecipientKind> = {
  /** User rows are already query-matched and ordered; non-user scoped extras
   * are matched locally. Do not rescore or drop personal rows in the picker. */
  items: Accessor<CombinedRecipientItem<K>[]>;
  loading: Accessor<boolean>;
  error: Accessor<Error | null>;
  incomplete: Accessor<boolean>;
  hasNext: Accessor<boolean>;
  windowKey: Accessor<string | undefined>;
  next: () => Promise<void>;
  retry: () => Promise<unknown>;
};

export type RecipientSourceInput = {
  search: Accessor<string>;
  enabled: Accessor<boolean>;
  selfId: Accessor<string | undefined>;
  senderDomain: Accessor<string | undefined>;
  includeSelf: Accessor<boolean>;
  /** An explicit scoped roster, not the personal contact directory. */
  excludedIds?: Accessor<ReadonlySet<string>>;
};

/** Construct under the selector's owner so closing/disposal releases its page. */
export type RecipientSourceFactory<K extends CombinedRecipientKind> = (
  input: RecipientSourceInput
) => RecipientSource<K>;
