import type { ConsentScopes } from '@service-auth/client';
import type { InboxAddition } from './link-outcome';

const RETURN_LAYOUT_KEY = 'macro:inbox-link:return-layout';

const CONSENT_SCOPES: ReadonlyArray<ConsentScopes> = [
  'gmail',
  'gmail_and_calendar',
  'calendar',
];

/** What the callback needs once the inbox consent round trip comes back. */
export type InboxLinkReturn = {
  /**
   * The base-relative layout URL the flow started from — path plus query and
   * hash, so content location state
   * survives with it.
   */
  url: string;
  /**
   * The permissions the flow asked consent for, so a refused consent can be
   * retried with the same request (a calendar entry point asks for the
   * mailbox and calendar together).
   */
  scopes?: ConsentScopes;
  /** Set only for a plain add; see {@link InboxAddition}. */
  addition?: InboxAddition;
};

type StoredInboxLinkReturn = InboxLinkReturn & { linkId: string };

/**
 * Remember where to return once inbox consent completes, and for a plain add
 * which inboxes were already connected.
 *
 * Web consent is a full page navigation; desktop opens the system browser and
 * its return deep link replaces the app route with the callback URL.
 * The layout lives in the URL, so stashing it here is what lets the callback
 * put the user back where they were instead of falling back to a default.
 *
 * `sessionStorage` rather than the OAuth `state`: the layout path carries
 * document and channel ids, and `state` is handed to the provider.
 *
 * Keyed by the link id the init call minted, which the callback receives back
 * as `link_id`, so an abandoned flow's leftovers can't hijack a later one.
 */
export function rememberInboxLinkReturn(
  linkId: string,
  value: InboxLinkReturn
): void {
  const stored: StoredInboxLinkReturn = { ...value, linkId };
  try {
    sessionStorage.setItem(RETURN_LAYOUT_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The
    // callback falls back to its default layout rather than failing the link.
  }
}

/**
 * What {@link rememberInboxLinkReturn} stashed for this link, left in place.
 * Returns undefined when nothing was stashed or the stash belongs to a
 * different flow.
 */
export function readInboxLinkReturn(
  linkId: string
): InboxLinkReturn | undefined {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(RETURN_LAYOUT_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  let stored: Partial<StoredInboxLinkReturn> | undefined;
  try {
    stored = JSON.parse(raw) as Partial<StoredInboxLinkReturn>;
  } catch {
    return undefined;
  }

  if (!stored || stored.linkId !== linkId || typeof stored.url !== 'string') {
    return undefined;
  }
  const scopes = CONSENT_SCOPES.find((value) => value === stored.scopes);
  return { url: stored.url, scopes, addition: stored.addition };
}

/** Read and clear the stash, as {@link readInboxLinkReturn} reads it. */
export function consumeInboxLinkReturn(
  linkId: string
): InboxLinkReturn | undefined {
  const stored = readInboxLinkReturn(linkId);
  // A stash that can't be matched is dead weight either way, so drop it.
  try {
    sessionStorage.removeItem(RETURN_LAYOUT_KEY);
  } catch {
    // Storage is unavailable, so there is nothing left to clear.
  }
  return stored;
}
