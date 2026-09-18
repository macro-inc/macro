/** Guest identities belong to a call session, not to a Macro account. */
export function isCallGuest(userId: string) {
  return userId.startsWith('guest:');
}
