const RETURN_LAYOUT_KEY = 'macro:inbox-link:return-layout';

/** Where the app should land once the Gmail consent round trip comes back. */
export type InboxLinkReturn = {
  /**
   * The base-relative layout URL the flow started from — path plus query and
   * hash, so the `preview` param encoding Controller/Viewer Preview Pairs
   * survives with it.
   */
  url: string;
  /**
   * `settingsReturnTo` as it stood at capture time, present when the flow
   * started from solo settings. Restoring it keeps "Back to app" pointing at
   * the layout behind settings instead of the default route.
   */
  settingsReturnTo?: string;
};

type StoredInboxLinkReturn = InboxLinkReturn & { linkId: string };

/**
 * Remember where to return once Gmail consent completes.
 *
 * On web and desktop the consent screen is a full page navigation, so the app
 * — split layout included — is torn down and rebuilt from the callback URL.
 * The layout lives in the URL, so stashing it here is what lets the callback
 * put the user back where they were instead of falling back to a default.
 *
 * `sessionStorage` rather than the OAuth `state`: the layout path carries
 * document and channel ids, and `state` is handed to Google.
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
 * Read and clear the layout stashed by {@link rememberInboxLinkReturn} for
 * this link. Returns undefined when nothing was stashed or the stash belongs
 * to a different flow.
 */
export function consumeInboxLinkReturn(
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
    stored = undefined;
  }

  // A stash that can't be matched is dead weight either way, so drop it.
  try {
    sessionStorage.removeItem(RETURN_LAYOUT_KEY);
  } catch {
    // Nothing to do — the read already succeeded.
  }

  if (!stored || stored.linkId !== linkId || typeof stored.url !== 'string') {
    return undefined;
  }
  return {
    url: stored.url,
    settingsReturnTo:
      typeof stored.settingsReturnTo === 'string'
        ? stored.settingsReturnTo
        : undefined,
  };
}
