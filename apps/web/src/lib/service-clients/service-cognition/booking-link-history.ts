/** Read old booking transcripts without restoring the removed execution UI. */
export function bookingLinkHistory(
  name: string,
  direction: 'call' | 'response',
  json: unknown
): unknown {
  if (
    (name !== 'CreateBookingLink' && name !== 'EditBookingLink') ||
    typeof json !== 'object' ||
    json === null
  ) {
    return json;
  }
  if (direction === 'response' && 'UserAction' in json) return json.UserAction;
  if (direction === 'call' && !('userConfirmation' in json)) {
    // Display only: empty confirmation cannot execute on the backend, and these
    // tools no longer have a frontend execution path. Never fabricate approval.
    return { ...json, userConfirmation: '' };
  }
  return json;
}
