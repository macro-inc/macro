import { globalSplitManager } from '@app/signal/splitLayout';
import { type Accessor, createEffect, on, onCleanup, untrack } from 'solid-js';

/** The close requests of the sheets open right now. */
const OPEN_SHEETS = new Set<() => void>();

/**
 * The page the app shows: the active pane and the content in it. A search
 * change (a filter, a target message) keeps the page, so a filter sheet stays
 * open while it filters.
 */
function shownPage(): string | undefined {
  const split = globalSplitManager()?.activeSplit();
  if (!split) return;

  const content = split.content();
  return `${split.id}:${content.type}:${content.id}`;
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
 * asks to confirm a discard first, still does. A sheet opened before any page
 * showed (during startup) closes only for `closeSheetsForNavigation`.
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

    const openedOver = untrack(shownPage);
    if (openedOver === undefined) return;

    createEffect(
      on(
        shownPage,
        (page) => {
          if (page !== openedOver) request();
        },
        { defer: true }
      )
    );
  });
}
