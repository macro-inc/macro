import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import type {
  PaneId,
  SplitLocation,
  SplitPanePolicy,
} from '@app/lib/split-router';
import { paneRootMatch } from '@app/routes/app-route';
import type { SplitContent, SplitId, SplitManager } from '../layoutManager';

type AppPanePolicyOptions = {
  manager: () => SplitManager | undefined;
  toContent: (location: SplitLocation) => SplitContent;
  defaultLocation: () => SplitLocation;
  /** Panes stack, as on native mobile: a new pane always goes in front, whatever fits on screen. */
  stacked: () => boolean;
};

/** A component view other than an agent conversation, which is an entity. */
function isShellComponent(content: SplitContent): boolean {
  if (content.type !== 'component') return false;

  return parseAgentsRoute(content.id) === undefined;
}

const splitOf = (pane: PaneId) => pane as string as SplitId;

/** The app's decisions about panes: where new ones go, what closing one does, and focus. */
export function createAppPanePolicy(
  options: AppPanePolicyOptions
): SplitPanePolicy {
  const sameRoot = (left: SplitLocation, right: SplitLocation) =>
    paneRootMatch(left.route)?.id === paneRootMatch(right.route)?.id;

  return {
    // Entity views are always reused; only shell components may be duplicated.
    placeNewPane({
      destination,
      source,
      intent,
      panes,
      holder,
      allowDuplicate,
    }) {
      const content = options.toContent(destination);
      const duplicatesShell = allowDuplicate && isShellComponent(content);
      const reuses = holder !== undefined && !duplicatesShell;
      if (reuses) return { pane: holder };
      if (options.stacked()) return { insertAt: panes.length };

      // Opens the manager already placed skip the capacity check.
      const fallback = source ?? panes.at(-1);
      const full =
        intent.direct !== true && !options.manager()?.canAppendSplit();
      if (full && fallback) return { pane: fallback };

      const { insertIndex } = intent;
      if (typeof insertIndex === 'number') {
        return { insertAt: Math.max(0, Math.min(insertIndex, panes.length)) };
      }

      return { insertAt: panes.length };
    },

    // The last pane shows the default view instead of closing.
    closeAction({ pane, panes }) {
      if (panes.length > 1) return { type: 'remove' };

      const destination = options.defaultLocation();
      const current = options.manager()?.getSplit(splitOf(pane))?.content();
      const showsDefault =
        current?.entryMetadata !== undefined &&
        sameRoot(current.entryMetadata as SplitLocation, destination);
      if (showsDefault) return { type: 'keep' };

      return { type: 'navigate', destination };
    },

    activate: (pane) => options.manager()?.activateSplit(splitOf(pane)),
  };
}
