/** Matches `user_api_key::domain::models::MAX_KEY_NAME_LEN`. */
export const MAX_USER_API_KEY_NAME_LEN = 100;

/** Matches `user_api_key::domain::service::MAX_KEYS_PER_USER`. */
export const MAX_USER_API_KEYS = 20;

export type NormalizedUserApiKeyName =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Trim and validate a user-facing API key name the same way the backend does:
 * non-empty after trim, at most {@link MAX_USER_API_KEY_NAME_LEN} Unicode
 * scalar values.
 */
export function normalizeUserApiKeyName(
  name: string
): NormalizedUserApiKeyName {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'API key name must not be empty' };
  }
  if ([...trimmed].length > MAX_USER_API_KEY_NAME_LEN) {
    return {
      ok: false,
      error: `API key name must be at most ${MAX_USER_API_KEY_NAME_LEN} characters`,
    };
  }
  return { ok: true, name: trimmed };
}
