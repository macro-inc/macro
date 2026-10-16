/** Ownership facts used to offer a private conversation with a persona. */
type PersonaOwner =
  | { type: 'user'; user_id: string }
  | { type: 'team'; team_id: string };

/** Sharing a channel with an agent does not make its private DM available. */
export function canDirectMessagePersona(
  owner: PersonaOwner | undefined | null,
  userId: string | undefined,
  teamId: string | undefined
): boolean {
  if (!owner || !userId) return false;
  return owner.type === 'user'
    ? owner.user_id === userId
    : owner.team_id === teamId;
}

/** A private persona conversation cannot contain additional recipients. */
export function selectConversationRecipients<T extends { kind: string }>(
  next: T[]
): T[] {
  const newest = next.at(-1);
  return newest?.kind === 'agent'
    ? [newest]
    : next.filter((recipient) => recipient.kind !== 'agent');
}
