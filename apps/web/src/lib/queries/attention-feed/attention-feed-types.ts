/** What one live change does to a feed. */
export type AttentionFeedChange<Entry> =
  | { kind: 'upserted'; entry: Entry }
  | { kind: 'removed'; key: string }
  | { kind: 'invalidated' };

/** A place in a feed's order; a page's `nextPosition` is where its read stopped. */
export type AttentionFeedPosition = { sortAt: string; entityId: string };

/** How a feed orders its entries, in the server's order. */
export type AttentionFeedOrder<Entry> = {
  /** The entry's `<entity type>:<entity id>` key; changes address it. */
  key: (entry: Entry) => string;
  /** The entry's place in the feed, RFC 3339. */
  sortAt: (entry: Entry) => string;
};

/**
 * How one feed's GraphQL documents fit the shared feed client. Home's work
 * feed and the notification inbox each select their own page, entry and
 * patch fragments; both page `<entity type>:<entity id>` entries newest first.
 */
export type AttentionFeedShape<Page, Entry, Patch> =
  AttentionFeedOrder<Entry> & {
    change: (patch: Patch) => AttentionFeedChange<Entry>;
    entries: (page: Page) => readonly Entry[];
    /** Where the page's read stopped; absent once the feed is exhausted. */
    nextPosition: (page: Page) => AttentionFeedPosition | null | undefined;
    withEntries: (page: Page, entries: Entry[]) => Page;
  };
