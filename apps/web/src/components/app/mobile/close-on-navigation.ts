import { globalSplitManager } from '@app/signal/splitLayout';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

type OpenSheet = {
  /** The close request a scrim tap makes. */
  request: () => void;
  /** Asked already by the navigation under way, so its page change doesn't ask again. */
  askedByNavigation: boolean;
};

/** The sheets open right now. */
const OPEN_SHEETS = new Set<OpenSheet>();

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
 * Asks every open sheet to close, as tapping its scrim does, then runs
 * `navigate`. For a navigation that may land on the page already shown, such
 * as a notification tap: asking first lets a sheet the destination opens on
 * arrival stay open. The first page change before `navigate` settles is its
 * own and doesn't ask again, so an owner that refuses (to confirm a discard)
 * is asked once; a later one asks as usual.
 */
export async function closeSheetsForNavigation<T>(
  navigate: () => Promise<T>
): Promise<T> {
  const asked = [...OPEN_SHEETS];
  for (const sheet of asked) {
    sheet.askedByNavigation = true;
    sheet.request();
  }
  try {
    return await navigate();
  } finally {
    for (const sheet of asked) sheet.askedByNavigation = false;
  }
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

    const sheet: OpenSheet = {
      request: () => untrack(options.close),
      askedByNavigation: false,
    };
    OPEN_SHEETS.add(sheet);
    onCleanup(() => OPEN_SHEETS.delete(sheet));

    let openedOver = untrack(shownPage);
    if (openedOver === undefined) return;

    const page = createMemo(shownPage);
    createEffect(
      on(
        page,
        (shown) => {
          if (shown === openedOver) return;
          openedOver = shown;
          // The navigation that asked already gets one page change for free;
          // any other asks again.
          if (sheet.askedByNavigation) {
            sheet.askedByNavigation = false;
            return;
          }
          sheet.request();
        },
        { defer: true }
      )
    );
  });
}
