/** One independent navigation history; stable for the pane's lifetime. */
export type PaneId = string & { readonly PaneId: unique symbol };

/** How a pane reached its current entry. */
export type PaneArrival = 'fresh' | 'back' | 'forward' | 'replace';

/** What a pane's history holds. `props` are handed over once unless `keepProps` is set. */
export type PaneEntry = {
  readonly id: string;
  readonly props?: unknown;
  readonly keepProps?: boolean;
};

export type PaneSnapshot<E extends PaneEntry = PaneEntry> = {
  readonly entries: readonly E[];
  readonly index: number;
};

export type PaneChange<E extends PaneEntry = PaneEntry> =
  | { type: 'push'; entry: E }
  | { type: 'replace'; entry: E }
  /** Move to `index`; `entry` replaces the landed slot when a redirect changed it. */
  | { type: 'go'; index: number; entry: E }
  | { type: 'reset'; entries: readonly E[]; index: number };

export type HistoryTarget<E extends PaneEntry = PaneEntry> = {
  entry: E;
  index: number;
};

/**
 * Where each pane's entries live. `createPanes` reads it and commits changes
 * to it; implementations never move on their own. Reads of a live pane must be reactive.
 */
export interface PaneStore<E extends PaneEntry = PaneEntry> {
  create(pane: PaneId, entry: E): void;
  remove(pane: PaneId): void;
  read(pane: PaneId): PaneSnapshot<E> | undefined;
  apply(pane: PaneId, change: PaneChange<E>): void;
}

/** Where a destination lands: an existing pane, or a new pane at an index. */
export type Placement = { pane: PaneId } | { insertAt: number };

/** The caller's hints for placing a new pane. Policies extend this interface through declaration merging. */
export interface OpenIntent {
  readonly [key: string]: unknown;
}

export type OpenTarget =
  | { pane: PaneId }
  | { newPane: true; source?: PaneId; intent?: OpenIntent };

/** What closing a pane does once it is allowed to close. */
export type CloseAction<E extends PaneEntry = PaneEntry, D = unknown> =
  | { type: 'remove' }
  | { type: 'keep' }
  /** Show `destination` instead; `replace` leaves no back entry to the closed one. */
  | { type: 'navigate'; destination: D; replace?: boolean }
  /** Go back to the nearest earlier entry matching `to`; with none, do `otherwise` (keep by default). A refused jump keeps the pane. */
  | {
      type: 'back-to';
      to: (entry: E) => boolean;
      otherwise?: CloseAction<E, D>;
    };

/**
 * The app's decisions about panes: where a new one goes, what closing one
 * means, and what activating one does. The router asks; it never decides.
 */
export interface PanePolicy<E extends PaneEntry = PaneEntry, D = unknown> {
  /**
   * Where an open that asks for a new pane lands, for example the source
   * pane when there are enough. Returning `holder` brings it up; placing a
   * new pane beside it shows the destination twice.
   */
  placeNewPane(request: {
    destination: D;
    source?: PaneId;
    intent: OpenIntent;
    panes: readonly PaneId[];
    /** The pane already showing the destination, if any. */
    holder?: PaneId;
    /** The caller accepts a second view of what `holder` shows. */
    allowDuplicate: boolean;
    /** New panes still opening; `panes` doesn't include them yet. */
    opening: number;
  }): Placement;

  /** What closing a pane means, for example returning the last pane to a list instead of removing it. */
  closeAction(request: {
    pane: PaneId;
    panes: readonly PaneId[];
  }): CloseAction<E, D>;

  /** Called when an open lands on a pane that already shows the destination, and by `router.activatePane`. */
  activate(pane: PaneId): void;
}
