/**
 * A create under an id that already has a session: the harness's 409 with
 * `code: "session_id_taken"`. The client reads it once so callers match this.
 */
export const SESSION_ID_TAKEN = 'SESSION_ID_TAKEN' as const;

/** The harness's `code` for it. */
export const SESSION_ID_TAKEN_CODE = 'session_id_taken';

/**
 * The plain-text body a harness from before the code sent. A rollout bridge
 * only: removed once the coded harness is deployed (bead mac-qu6y).
 */
export const SESSION_ID_TAKEN_TEXT = 'this id is already taken';

/** Whether a create's 409 says the id is taken. */
export async function isSessionIdTaken(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  const text = (await response.clone().text()).trim();
  if (text === SESSION_ID_TAKEN_TEXT) return true;
  try {
    const body: unknown = JSON.parse(text);
    return (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === SESSION_ID_TAKEN_CODE
    );
  } catch {
    return false;
  }
}
