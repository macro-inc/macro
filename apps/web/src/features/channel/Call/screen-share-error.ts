/**
 * A screen share failure with a message meant for the user. Failures of the
 * browser's own picker are not: a cancelled picker rejects like a denial.
 */
export class ScreenShareError extends Error {
  override name = 'ScreenShareError';
}
