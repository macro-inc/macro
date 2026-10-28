/** One-time codes are six digits. */
const CODE_LENGTH = 6;

/** Seconds before the verify step offers to resend the code. */
export const RESEND_AFTER_SECONDS = 45;

export const isCompleteCode = (code: string) => code.length === CODE_LENGTH;

/**
 * The session code the auth service appended to the return URL. A redirect
 * URL with duplicate `token` params yields an array; the last is the newest.
 */
export function sessionTokenParam(value: unknown): string | undefined {
  const token = Array.isArray(value) ? value[value.length - 1] : value;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}
