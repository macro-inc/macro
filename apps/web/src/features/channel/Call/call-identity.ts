/**
 * Guest identities belong to a call session, not to a Macro account. A call
 * record lists guests separately from `participants` (Macro users only), and
 * guest transcript segments use the guest's bare uuid as `speakerId`, so a
 * guest is recognized by membership in the record's `guests` list.
 */
export function isCallGuestId(
  record: { guests: Array<{ id: string }> } | undefined,
  speakerOrUserId: string
): boolean {
  return record?.guests.some((guest) => guest.id === speakerOrUserId) ?? false;
}

/** Display name a guest provided when joining, if the id belongs to a guest. */
export function guestDisplayName(
  record: { guests: Array<{ id: string; displayName: string }> } | undefined,
  id: string
): string | undefined {
  return record?.guests.find((guest) => guest.id === id)?.displayName;
}
