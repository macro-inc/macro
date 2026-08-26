import { toBaseRelative } from '@app/constants/routerBase';
import { CHROME_SUB_APPS } from '@app/features/app-layout/chrome/chrome-destinations';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import { makePersisted } from '@solid-primitives/storage';
import { useLocation } from '@solidjs/router';
import { type Accessor, createMemo, createSignal } from 'solid-js';

/**
 * A window the dock is holding: one arrangement of splits that isn't simply a
 * destination the bar already has a button for. Opening an entity makes one;
 * so does opening a second split. Each keeps its place in the dock until it is
 * closed, so you can leave and come back to it.
 */
export type DockWindow = {
  /**
   * Identity: the leading split's content, not everything the window holds.
   * Splitting a window, closing that split, or resizing it all keep you in
   * the window you were in — the arrangement is what it is showing, not what
   * it is. Coming back to the same entity refills its window rather than
   * stacking a duplicate.
   */
  key: string;
  /** One per split, in the order they sit on screen. */
  titles: readonly string[];
  /** Entity type of the leading split, for the tab's icon. */
  iconType: EntityIconSelector;
  /** Base-relative router path that restores the whole arrangement. */
  path: string;
};

const contentKey = (content: SplitContent) => `${content.type}:${content.id}`;

/**
 * The contents the bar reaches on its own: the views and companion splits in
 * its rows, plus home behind the logo and settings behind the gear. Sitting on
 * one of these is not a window — there is already a button for it.
 */
const CHROME_REACHABLE_CONTENT = new Set<string>([
  'component:inbox',
  'component:settings',
  ...CHROME_SUB_APPS.map((destination) => contentKey(destination.content)),
]);

/** Beyond this the dock is a junk drawer, so the oldest window drops off. */
const MAX_DOCK_WINDOWS = 6;

const DOCK_WINDOWS_STORAGE_KEY = 'macro:pref:v4-dock-windows';

/**
 * Windows outlive the session, the way a browser keeps its tabs: leaving one
 * open is how you say you are coming back to it, and a reload is not an
 * answer to that. Malformed storage just starts the dock empty.
 */
const [dockWindows, setDockWindows] = makePersisted(
  createSignal<readonly DockWindow[]>([]),
  {
    name: DOCK_WINDOWS_STORAGE_KEY,
    deserialize(value) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as DockWindow[]) : [];
      } catch {
        return [];
      }
    },
  }
);

export { dockWindows };

/**
 * Record what the splits are showing. A window already standing for these
 * contents is refreshed in place — same position in the dock, current title
 * and path — so a rename or a step deeper doesn't spawn a second tab.
 */
export function rememberDockWindow(next: DockWindow) {
  setDockWindows((current) => {
    const index = current.findIndex((window) => window.key === next.key);
    if (index !== -1) {
      const refreshed = [...current];
      refreshed[index] = next;
      return refreshed;
    }

    const appended = [...current, next];
    return appended.length > MAX_DOCK_WINDOWS
      ? appended.slice(appended.length - MAX_DOCK_WINDOWS)
      : appended;
  });
}

export function forgetDockWindow(key: string) {
  setDockWindows((current) => current.filter((window) => window.key !== key));
}

/**
 * The window the splits are showing right now, or `undefined` while they show
 * a single destination the bar already reaches.
 *
 * A Preview Pair's Viewer is left out: it is the view's own reading pane, so
 * arrowing down an inbox with preview open stays inside that view instead of
 * filling the dock with a tab per message. Opening the same entity for real —
 * as its own split — still makes a window.
 *
 * The whole arrangement is reported, but only its lead names the window (see
 * `key`): splitting what you have changes the window you are in rather than
 * opening another one.
 */
export function createCurrentDockWindow(): Accessor<DockWindow | undefined> {
  const location = useLocation();

  return createMemo(() => {
    const manager = globalSplitManager();
    if (!manager) return undefined;

    const handles = manager
      .splits()
      .map((split) => manager.getSplit(split.id))
      .filter((handle) => handle !== undefined)
      .filter((handle) => !handle.isViewerSplit());
    if (handles.length === 0) return undefined;

    const contents = handles.map((handle) => handle.content());
    const first = contents[0]!;
    if (
      contents.length === 1 &&
      CHROME_REACHABLE_CONTENT.has(contentKey(first))
    )
      return undefined;

    return {
      key: contentKey(first),
      titles: handles.map((handle) => handle.displayName()),
      // A component split has no entity type of its own, so its name is the
      // best the icon set can match on. The selector is a closed union, but
      // the lookup behind it answers anything it doesn't know with a plain
      // file icon — which is the right answer for an unrecognized split.
      iconType: (first.type === 'component'
        ? first.id
        : first.type) as EntityIconSelector,
      path: toBaseRelative(location.pathname),
    };
  });
}
