/**
 * A create under an id that already has a session. The harness answers it as
 * a plain-text 409; the client reads it once so callers match this code.
 */
export const SESSION_ID_TAKEN = 'SESSION_ID_TAKEN' as const;

/** The harness's text for it. */
export const SESSION_ID_TAKEN_TEXT = 'this id is already taken';
