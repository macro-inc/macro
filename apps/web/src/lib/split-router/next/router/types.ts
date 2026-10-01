import type { HistoryAdapter } from '../history/types';
import type { Panes } from '../panes/panes';
import type { CloseAction, PanePolicy, PaneStore } from '../panes/types';
import type {
  Entry,
  PaneId,
  SplitLocation,
  SplitRouteInfo,
  SplitRouteParams,
  SplitRoutes,
  SplitSearchUpdate,
} from '../routes/types';
import type { MaybePromise } from '../utils';
import type { EntryOptions } from './entries';
import type { SplitRouterMiddleware } from './middleware';

export type NavigationCause =
  | 'initial'
  | 'external'
  | 'navigate'
  | 'history'
  | 'search';

/** Where one pane is going. */
export type PaneTarget = {
  pane: PaneId;
  from?: Entry;
  to: Entry;
};

/** How a visit records its entry in the pane's history. */
export type VisitHistory =
  | 'push'
  | 'replace'
  | { go: number }
  | { reset: readonly Entry[]; index: number };

/** Who shows a claimed resource: a pane, or a preview or popover registered for it. */
export type ClaimOwner = PaneId | symbol;

export type NavigationResult =
  | { status: 'committed'; pane: PaneId }
  | { status: 'activated'; owner: ClaimOwner }
  | { status: 'unchanged'; pane: PaneId }
  | { status: 'cancelled' };

export const CANCELLED_RESULT: NavigationResult = { status: 'cancelled' };

/** A change to what panes show: guards, then middleware, then preload, then `apply`. */
export type Navigation = {
  cause: NavigationCause;
  targets: readonly PaneTarget[];
  /** Panes being removed; their leave guards must allow it too. */
  removed?: readonly PaneId[];
  /** Raw incoming query on initial and external navigation. */
  externalSearch?: string;
  /** Undo what started it, such as a browser back. */
  revert?: () => MaybePromise<void>;
  /** Changes the panes to show `entries`, one per target, and writes the URL. */
  apply(entries: readonly Entry[]): NavigationResult;
};

export type CancelReason =
  /** A leave guard said no. */
  | 'refused'
  /** Middleware cancelled it. */
  | 'cancelled'
  /** A newer navigation replaced it. */
  | 'superseded'
  /** A pane action took over from a URL navigation. */
  | 'interrupted'
  | 'disposed'
  | 'failed';

/** The pane policy for panes that show routes. */
export type SplitPanePolicy = PanePolicy<Entry, SplitLocation>;
export type SplitCloseAction = CloseAction<Entry, SplitLocation>;
export type RouterPanes = Panes<Entry, SplitLocation>;

export type SplitNavigateOptions = EntryOptions & {
  replace?: boolean;
  search?: Readonly<Record<string, SplitSearchUpdate>>;
  /** Commit even when another pane or preview already shows the destination. */
  allowDuplicate?: boolean;
  /** Depth of the calling outlet; relative paths resolve against it. */
  depth?: number;
};

export type LeaveGuardContext = {
  pane: PaneId;
  from: Entry;
  /** Undefined when the pane closes or the host leaves the router's routes. */
  to?: Entry;
  cause: NavigationCause;
  signal: AbortSignal;
};

export type LeaveGuard = (context: LeaveGuardContext) => MaybePromise<boolean>;

export type RouteMatchInfo = {
  id: string;
  params: SplitRouteParams;
  info?: SplitRouteInfo;
};

export type SplitRouterOptions = {
  routes: SplitRoutes;
  history: HistoryAdapter;
  paneStore: PaneStore<Entry>;
  policy: SplitPanePolicy;
  middleware?: readonly SplitRouterMiddleware[];
  /** How long a navigation waits for route data preloads before committing. */
  preloadBudgetMs?: number;
  createPaneId?: () => PaneId;
};
