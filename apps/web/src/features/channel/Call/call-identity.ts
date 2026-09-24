/**
 * Guest transcript speakers use session UUIDs listed in the record's guests.
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
