/** A cached signed-out result is a logout marker, not identity for a later login. */
export function hasCachedUserIdentity(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'authenticated' in data &&
    data.authenticated === true &&
    'id' in data &&
    typeof data.id === 'string' &&
    data.id.length > 0
  );
}
