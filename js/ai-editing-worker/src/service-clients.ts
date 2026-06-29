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
