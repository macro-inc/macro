/**
 * Deriving the *external* people on an email thread or a calendar event.
 *
 * "External" is defined the way the Correspondence panel needs it: everybody
 * who is neither the signed-in user nor on the user's own email domain. That
 * domain comparison is the whole internal/external test — a teammate on a
 * second company domain reads as external, which is the trade the simple rule
 * buys.
 */

/** A person on an email thread or a calendar event. */
export interface CorrespondenceParty {
  /** Lowercased email address — the identity key for a party. */
  email: string;
  /** Display name observed for the address, when the source carried one. */
  name?: string;
}

/** The external parties sharing one email domain. */
export interface CorrespondencePartyGroup {
  /** Lowercased domain the group's addresses share. */
  domain: string;
  /** Parties on that domain, in first-seen order. */
  parties: CorrespondenceParty[];
}

/**
 * The lowercased domain of `email`, or `undefined` when the address has no
 * usable domain part (empty input, a bare local part, a trailing `@`).
 */
export function addressDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return undefined;
  return trimmed.slice(at + 1).toLowerCase();
}

/**
 * Narrows raw participants down to the external ones, deduped on the
 * lowercased address (first non-empty display name wins) and returned in
 * first-seen order.
 *
 * Returns an empty list when the signed-in user's own address is unknown or
 * domainless: without a domain to compare against there is no way to tell a
 * teammate from a customer, and guessing would put colleagues in the panel.
 */
export function externalParties(
  parties: Iterable<CorrespondenceParty>,
  selfEmail: string | undefined
): CorrespondenceParty[] {
  const self = selfEmail?.trim().toLowerCase();
  const internalDomain = addressDomain(self);
  if (!self || !internalDomain) return [];

  const byAddress = new Map<string, CorrespondenceParty>();
  for (const party of parties) {
    const email = party.email?.trim().toLowerCase();
    if (!email || email === self) continue;

    const domain = addressDomain(email);
    if (!domain || domain === internalDomain) continue;

    const name = party.name?.trim() || undefined;
    const existing = byAddress.get(email);
    if (!existing) {
      byAddress.set(email, { email, name });
    } else if (!existing.name && name) {
      existing.name = name;
    }
  }

  return [...byAddress.values()];
}

/**
 * Buckets parties by their email domain, preserving first-seen order for both
 * the groups and the parties inside them.
 *
 * The panel renders one card per group — a company and the people on it — so
 * the domain → CRM company lookup happens once per company rather than once
 * per contact.
 */
export function groupPartiesByDomain(
  parties: CorrespondenceParty[]
): CorrespondencePartyGroup[] {
  const groups = new Map<string, CorrespondencePartyGroup>();
  for (const party of parties) {
    const domain = addressDomain(party.email);
    if (!domain) continue;
    const group = groups.get(domain);
    if (group) {
      group.parties.push(party);
    } else {
      groups.set(domain, { domain, parties: [party] });
    }
  }
  return [...groups.values()];
}
