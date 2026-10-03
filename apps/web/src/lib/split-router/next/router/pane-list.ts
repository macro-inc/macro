import { match } from 'ts-pattern';
import type { OpenTarget, Placement } from '../panes/types';
import { canonicalRoute, type SplitRoutesManifest } from '../routes/manifest';
import type {
  Entry,
  PaneId,
  SplitLocation,
  SplitNavigationTarget,
  SplitRouteState,
} from '../routes/types';
import { type MaybePromise, mapMaybe } from '../utils';
import type { Claims } from './claims';
import { createEntry } from './entries';
import type { PaneNavigation } from './pane-navigation';
import type { Runner } from './runner';
import {
  CANCELLED_RESULT,
  type Navigation,
  type NavigationResult,
  type RouterPanes,
  type SplitCloseAction,
  type SplitNavigateOptions,
} from './types';
import type { Url } from './url';

const KEEP: SplitCloseAction = { type: 'keep' };

const isCommitted = (result: NavigationResult) => result.status === 'committed';

const committed = (pane: PaneId): NavigationResult => ({
  status: 'committed',
  pane,
});

/** A policy's location checked against the route table; undefined when it isn't one. */
function canonicalLocation(
  routes: SplitRoutesManifest,
  location: SplitLocation
): SplitLocation | undefined {
  let route: SplitRouteState | undefined;

  try {
    route = canonicalRoute(routes, location.route);
  } catch {
    route = undefined;
  }

  if (!route) {
    console.error('Split router close action leads to no route', location);
    return;
  }

  return { ...location, route };
}

/** Which panes there are: opening, closing and moving them, as the policy decides. */
export function createPaneList(options: {
  routes: SplitRoutesManifest;
  panes: RouterPanes;
  url: Url;
  runner: Runner;
  claims: Claims;
  navigation: PaneNavigation;
}) {
  const { routes, panes, url, runner, claims, navigation } = options;
  let opening = 0;

  /** The entry an open's relative target resolves against. */
  const openBase = (target: OpenTarget): Entry | undefined => {
    const pane = 'pane' in target ? target.pane : target.source;
    if (!pane) return;

    return panes.current(pane);
  };

  /** Where an open lands; `holder` is the pane the policy was told shows the destination. */
  const placementFor = (
    location: SplitLocation,
    target: OpenTarget,
    navigateOptions: SplitNavigateOptions
  ): { placement: Placement; holder?: PaneId } => {
    if ('pane' in target) return { placement: target };

    const holder = claims.paneShowing(location);
    const placement = panes.placeNewPane({
      destination: location,
      source: target.source,
      intent: target.intent,
      holder,
      allowDuplicate: navigateOptions.allowDuplicate,
      opening,
    });

    return { placement, holder };
  };

  function openIn(
    pane: PaneId,
    location: SplitLocation,
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult> {
    const from = panes.current(pane);
    if (!from) return CANCELLED_RESULT;

    const result = navigation.visitLocation(
      pane,
      from,
      location,
      navigateOptions
    );

    return mapMaybe(result, (outcome): NavigationResult => {
      if (outcome.status !== 'unchanged') return outcome;

      return claims.reveal(pane);
    });
  }

  /**
   * Counted until it lands, so placement sees panes still on their way.
   * `besides` is a pane the policy chose to open beside rather than bring up.
   */
  function openNew(
    location: SplitLocation,
    placement: { insertAt: number; besides?: PaneId },
    navigateOptions: SplitNavigateOptions
  ): MaybePromise<NavigationResult> {
    const { insertAt, besides } = placement;
    const pane = panes.createPaneId();
    const entry = createEntry(routes, location, undefined, navigateOptions);
    const decided = panes.ids();
    const check = {
      pane,
      besides,
      allowDuplicate: navigateOptions.allowDuplicate,
      mode: 'push' as const,
    };

    const apply = ([landed]: readonly Entry[]) =>
      claims.applyUnlessHeld(check, landed!, () => {
        panes.insert(pane, landed!, insertAt, decided);
        url.write('push');

        return committed(pane);
      });

    const opened: Navigation = {
      cause: 'navigate',
      targets: [{ pane, to: entry }],
      apply,
    };

    opening += 1;
    const result = runner.start(pane, opened);

    return mapMaybe(result, (outcome) => {
      opening -= 1;

      return outcome;
    });
  }

  const removePane = (pane: PaneId) => {
    const result = runner.start(pane, {
      cause: 'navigate',
      targets: [],
      removed: [pane],
      apply: () => {
        panes.remove(pane);
        url.write('push');

        return committed(pane);
      },
    });

    return mapMaybe(result, isCommitted);
  };

  function runCloseAction(
    pane: PaneId,
    from: Entry,
    closeAction: SplitCloseAction
  ): MaybePromise<boolean> {
    return match(closeAction)
      .with({ type: 'keep' }, () => false)
      .with({ type: 'remove' }, () => removePane(pane))
      .with({ type: 'navigate' }, ({ destination, replace }) => {
        const location = canonicalLocation(routes, destination);
        if (!location) return false;

        const result = navigation.visitLocation(pane, from, location, {
          replace,
        });

        return mapMaybe(result, isCommitted);
      })
      .with({ type: 'back-to' }, ({ to, otherwise = KEEP }) => {
        const step = navigation.backStep(pane, to);
        // A refused jump keeps the pane; only a missing entry falls back.
        if (!step) return runCloseAction(pane, from, otherwise);

        return navigation.jumpBack(pane, from, step);
      })
      .exhaustive();
  }

  return {
    /**
     * Open a destination in a pane, or where the policy places a new pane.
     * Relative targets resolve against that pane or the new pane's source.
     */
    open(
      to: SplitNavigationTarget,
      target: OpenTarget,
      navigateOptions: SplitNavigateOptions = {}
    ): MaybePromise<NavigationResult> {
      return runner.act(CANCELLED_RESULT, () => {
        const base = openBase(target);
        const location = navigation.resolve(base, to, navigateOptions);
        if (!location) return CANCELLED_RESULT;

        const intoPane = 'pane' in target ? target.pane : undefined;
        if (navigation.leavesSharedRoute(intoPane, location)) {
          return navigation.showAlone(location, navigateOptions);
        }

        const { placement, holder } = placementFor(
          location,
          target,
          navigateOptions
        );

        if ('pane' in placement) {
          return openIn(placement.pane, location, navigateOptions);
        }

        const { insertAt } = placement;

        return openNew(
          location,
          { insertAt, besides: holder },
          navigateOptions
        );
      });
    },

    /** Close a pane the way the policy decides; removal waits for leave guards. */
    close(pane: PaneId): MaybePromise<boolean> {
      return runner.act(false, () => {
        const from = panes.current(pane);
        if (!from) return false;

        return runCloseAction(pane, from, panes.closeAction(pane));
      });
    },

    /** Remove a pane without asking the policy; its leave guards still apply. */
    remove(pane: PaneId): MaybePromise<boolean> {
      return runner.act(false, () => {
        const exists = panes.current(pane) !== undefined;
        if (!exists) return false;

        return removePane(pane);
      });
    },

    move(pane: PaneId, to: number): void {
      void runner.act(undefined, () => {
        runner.commitNow({
          cause: 'navigate',
          targets: [],
          apply: () => {
            const moved = panes.move(pane, to);
            if (moved) url.write('push');

            return committed(pane);
          },
        });
      });
    },
  };
}
