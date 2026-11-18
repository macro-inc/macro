import { globalSplitManager } from '@app/signal/splitLayout';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

/** The close requests of the sheets open right now. */
const OPEN_SHEETS = new Set<() => void>();

/**
 * The page the app shows: the view mounted in the active pane. Navigating to
 * other content mounts a new view, and another pane has its own. A search
 * change (a filter, a target message) keeps the view, and so does a pane
 * adopting the real id of what it shows (a provisioned agent session).
 */
export function shownPage(): unknown {
  const manager = globalSplitManager();
  const id = manager?.activeSplitId();
  if (!manager || !id) return;

  return manager.splitState(id)?.mount.element;
}

/**
 * Asks every open sheet to close, as tapping its scrim does. For a navigation
 * that may land on the page already shown, such as a notification tap, call it
 * before navigating, so a sheet the destination opens on arrival stays open.
 */
export function closeSheetsForNavigation() {
  for (const close of [...OPEN_SHEETS]) close();
}

/**
 * Closes a sheet when the app shows another page than the one it opened over,
 * however that happens: a notification tap, a link, an agent, the dock, Back.
 * Phones keep the pane behind the front one mounted for swipe-back, and app
 * chrome never unmounts, so a sheet's owner outlives the navigation and its
 * portaled sheet would otherwise stay over the new page.
 *
 * `close` makes the request a scrim tap makes: an owner that refuses it, or
 * asks to confirm a discard first, still does, and is asked again only on the
 * next navigation. A sheet opened before any page showed (during startup)
 * closes only for `closeSheetsForNavigation`.
 */
export function createCloseOnNavigation(options: {
  open: Accessor<boolean>;
  close: () => void;
}) {
  createEffect(() => {
    if (!options.open()) return;

    const request = () => untrack(options.close);
    OPEN_SHEETS.add(request);
    onCleanup(() => OPEN_SHEETS.delete(request));

    let openedOver = untrack(shownPage);
    if (openedOver === undefined) return;

    const page = createMemo(shownPage);
    createEffect(
      on(
        page,
        (shown) => {
          if (shown === openedOver) return;
          openedOver = shown;
          request();
        },
        { defer: true }
      )
    );
  });
}
