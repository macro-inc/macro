/**
 * Where registered work shows. Registering is open to every account; these
 * only decide display, and are kept here so the rules are easy to change.
 */

/** A direct message shows the other account's work only if it's an agent. */
export function dmWorkAccount(options: {
  isDirectMessage: boolean;
  participantIds: readonly string[];
  viewerId: string | undefined;
  isAgentAccount: (id: string) => boolean;
}): string | undefined {
  if (!options.isDirectMessage) return undefined;

  const others = options.participantIds.filter((id) => id !== options.viewerId);
  if (others.length !== 1) return undefined;

  const [other] = others;
  return options.isAgentAccount(other) ? other : undefined;
}

/** A call shows the work of everyone else in it, person or agent. */
export function callWorkAccounts(
  participantIds: readonly (string | undefined)[]
): string[] {
  const accounts = participantIds.filter((id) => id !== undefined);
  return [...new Set(accounts)].sort();
}
