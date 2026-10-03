import { createStore, produce } from 'solid-js/store';
import type { SplitRoutesManifest } from '../routes/manifest';
import { claimOf } from '../routes/queries';
import type { Entry, PaneId, SplitLocation, WriteMode } from '../routes/types';
import type { Runner } from './runner';
import type { ClaimOwner, NavigationResult, RouterPanes } from './types';

export type ClaimHolder = {
  owner: ClaimOwner;
  /** The pane showing this holder, if any. Navigation in that pane never yields to it. */
  pane?: PaneId;
  claim: string;
  activate(): void;
};

type ClaimSource = () => readonly ClaimHolder[];

/** Who currently shows each resource: panes, inline previews and popovers. */
type ClaimsRegistry = {
  holderOf(claim: string, excludePane?: PaneId): ClaimHolder | undefined;
  register(source: ClaimSource): () => void;
};

/** Who is about to show an entry, for choosing the holder that shows it instead. */
type ClaimCheck = {
  /** The pane the entry would show in; holders there don't count. */
  pane?: PaneId;
  /** What that pane showed; a claim it already held is not a new acquisition. */
  from?: Entry;
  allowDuplicate?: boolean;
  /** A pane the placement policy was told shows the entry and opened a new pane beside. */
  besides?: PaneId;
};

/** A visit or open about to apply. */
type Acquisition = ClaimCheck & {
  /** How the holder takes the entry's search when it is brought up instead. */
  mode: WriteMode;
};

export type Claims = ReturnType<typeof createClaims>;

/** The claim an entry holds, if its route declares one. */
function entryClaim(
  routes: SplitRoutesManifest,
  entry: Pick<Entry, 'location'> | undefined
): string | undefined {
  if (!entry) return;

  return claimOf(routes, entry.location.route);
}

/** A pane showing the resource itself, not a preview shown inside a pane. */
function isPaneHolder(
  holder: ClaimHolder | undefined
): holder is ClaimHolder & { pane: PaneId } {
  if (!holder) return false;

  return holder.pane !== undefined && holder.owner === holder.pane;
}

function isInPane(holder: ClaimHolder, pane: PaneId): boolean {
  const shownInPane = holder.pane === pane;

  return shownInPane || holder.owner === pane;
}

function holdsClaim(
  holder: ClaimHolder,
  claim: string,
  excludePane: PaneId | undefined
): boolean {
  if (holder.claim !== claim) return false;
  if (excludePane === undefined) return true;

  return !isInPane(holder, excludePane);
}

function createRegistry(): ClaimsRegistry {
  const [state, setState] = createStore<{ sources: ClaimSource[] }>({
    sources: [],
  });

  const addSource = (source: ClaimSource) => {
    setState(
      produce((draft) => {
        draft.sources.push(source);
      })
    );
  };

  const removeSource = (source: ClaimSource) => {
    setState(
      produce((draft) => {
        const index = draft.sources.indexOf(source);
        if (index >= 0) draft.sources.splice(index, 1);
      })
    );
  };

  return {
    holderOf(claim, excludePane) {
      for (const source of state.sources) {
        const holder = source().find((candidate) =>
          holdsClaim(candidate, claim, excludePane)
        );
        if (holder) return holder;
      }
    },

    register(source) {
      addSource(source);

      return () => removeSource(source);
    },
  };
}

/**
 * Who shows each resource a route claims. A visit or open landing on a claim
 * shown elsewhere brings that holder up instead, unless the caller allows a
 * duplicate or the placement policy opened beside it. Which routes claim, and
 * where duplicates may open, is the app's to decide.
 */
export function createClaims(options: {
  routes: SplitRoutesManifest;
  panes: RouterPanes;
  runner: Runner;
  /** Carries `destination`'s search to `pane`, which already shows it, once the current commit is done. */
  carrySearch(pane: PaneId, destination: Entry, mode: WriteMode): void;
}) {
  const { routes, panes, runner } = options;
  const registry = createRegistry();

  const paneHolders = (): ClaimHolder[] =>
    panes.ids().flatMap((pane) => {
      const claim = entryClaim(routes, panes.current(pane));
      if (!claim) return [];

      const activate = () => panes.activate(pane);

      return [{ owner: pane, pane, claim, activate }];
    });

  const unregisterPanes = registry.register(paneHolders);

  /** The holder that shows `entry` instead, if any. */
  const holderFor = (
    check: ClaimCheck,
    entry: Pick<Entry, 'location'>
  ): ClaimHolder | undefined => {
    if (check.allowDuplicate) return;

    const claim = entryClaim(routes, entry);
    if (!claim) return;

    // Changing params or search without changing the pane's claim is not a new acquisition.
    const alreadyHeld = claim === entryClaim(routes, check.from);
    if (alreadyHeld) return;

    const holder = registry.holderOf(claim, check.pane);
    if (!holder) return;

    const openedBeside =
      check.besides !== undefined && isInPane(holder, check.besides);
    if (openedBeside) return;

    return holder;
  };

  /** Whether the pane's run would move it off `claim`. */
  const leavesClaim = (pane: PaneId, claim: string) => {
    const navigation = runner.inFlight(pane);
    if (!navigation) return false;

    const target = navigation.targets.find(
      (candidate) => candidate.pane === pane
    );
    if (!target) return true;

    return entryClaim(routes, target.to) !== claim;
  };

  /** Keeps the holder's pane on the resource, hands it the search, and brings it up. */
  const yieldTo = (
    holder: ClaimHolder,
    destination: Entry,
    mode: WriteMode
  ): NavigationResult => {
    if (isPaneHolder(holder)) {
      const departing = leavesClaim(holder.pane, holder.claim);
      if (departing) runner.abort(holder.pane);

      options.carrySearch(holder.pane, destination, mode);
    }

    holder.activate();

    return { status: 'activated', owner: holder.owner };
  };

  return {
    registry,

    /** Runs `apply` unless another pane or preview already shows `entry`. */
    applyUnlessHeld(
      acquisition: Acquisition,
      entry: Entry,
      apply: () => NavigationResult
    ): NavigationResult {
      const holder = holderFor(acquisition, entry);
      if (!holder) return apply();

      return yieldTo(holder, entry, acquisition.mode);
    },

    /** Brings up `pane`, which already shows what was opened. */
    reveal(pane: PaneId): NavigationResult {
      panes.activate(pane);

      return { status: 'activated', owner: pane };
    },

    /** Back and Forward in `pane` skip entries shown elsewhere, unless duplicates are allowed. */
    canVisit(pane: PaneId, allowDuplicate?: boolean) {
      return (entry: Entry) => {
        const holder = holderFor({ pane, allowDuplicate }, entry);

        return holder === undefined;
      };
    },

    /** The pane showing `location`'s resource, not a preview inside some pane. */
    paneShowing(location: SplitLocation): PaneId | undefined {
      const holder = holderFor({}, { location });
      if (!isPaneHolder(holder)) return;

      return holder.pane;
    },

    dispose: unregisterPanes,
  };
}
