export async function fetchDocToken(
  dssBase: string,
  documentId: string,
  userToken: string
): Promise<string> {
  const resp = await fetch(
    `${dssBase}/documents/permissions_token/${documentId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${userToken}` } }
  );
  if (!resp.ok) {
    throw new Error(`failed to get document permission token: ${resp.status}`);
  }
  const { token } = (await resp.json()) as { token: string };
  return token;
}

/**
 * Whether a human collaborator is currently connected to the document, per the
 * sync service's `active_peers` (AI editor peers excluded). Fails open (returns
 * `true`) so a flaky check never silently disables animations.
 */
export async function hasHumanEditors(
  syncWsBase: string,
  documentId: string,
  docToken: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const httpBase = syncWsBase.replace(/^ws/, 'http');
    const resp = await fetch(
      `${httpBase}/document/${documentId}/active_peers?include_ai=false`,
      { headers: { Authorization: `Bearer ${docToken}` }, signal }
    );
    if (!resp.ok) return true;
    const peers = (await resp.json()) as string[];
    return peers.length > 0;
  } catch (err) {
    console.error('hasHumanEditors check failed:', err);
    // we fallback to showing animations
    return true;
  }
}

/** How often presence is re-checked while an edit is animating. */
const PRESENCE_POLL_MS = 2_500;

/**
 * Polls human presence and exposes a live animation speed multiplier: `1` while
 * a human is watching, `unwatchedSpeed` when nobody is — so unseen edits play
 * faster instead of being skipped, and a viewer who joins mid-edit slows it back
 * to 1x. Fails open to watched (1x) on any check error. Caller must `stop()` when
 * the edit finishes; aborting the signal also stops it.
 */
export function watchPresenceSpeed(opts: {
  syncWsBase: string;
  documentId: string;
  docToken: string;
  unwatchedSpeed: number;
  signal?: AbortSignal;
}): { multiplier: () => number; stop: () => void } {
  let multiplier = 1;
  const poll = async () => {
    const watched = await hasHumanEditors(
      opts.syncWsBase,
      opts.documentId,
      opts.docToken,
      opts.signal
    );
    multiplier = watched ? 1 : opts.unwatchedSpeed;
  };
  void poll();
  const timer = setInterval(() => void poll(), PRESENCE_POLL_MS);
  const stop = () => clearInterval(timer);
  opts.signal?.addEventListener('abort', stop);
  return { multiplier: () => multiplier, stop };
}
