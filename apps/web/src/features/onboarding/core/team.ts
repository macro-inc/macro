/** How many same-domain teammates get pre-added to the invite list. */
export const PREFILL_CAP = 6;

export const isPlausibleEmail = (value: string) =>
  /^\S+@\S+\.\S+$/.test(value.trim());

/** The part after `@`, lowercased — `undefined` when it isn't an address. */
export function emailDomain(address: string | undefined): string | undefined {
  const at = address?.lastIndexOf('@') ?? -1;
  if (!address || at < 1 || at === address.length - 1) return undefined;
  return address.slice(at + 1).toLowerCase();
}

/** "macro.com" → "Macro": the domain root, capitalized. Whether a domain
 * deserves a team suggestion at all is judged server-side
 * (`suggestedTeamDomain`) — no domain list lives here. */
export function deriveTeamName(domain: string): string {
  const root = domain.split('.')[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/**
 * Same-domain teammates worth pre-adding to the invite list: the user's
 * contacts on `domain`, minus themselves, deduped and capped.
 *
 * Empty when the domain isn't team-worthy — the server decides that via
 * `suggestedTeamDomain`.
 */
export function prefillableTeammates(args: {
  contacts: readonly string[];
  domain: string | undefined;
  ownEmail: string | undefined;
}): string[] {
  const { contacts, domain, ownEmail } = args;
  if (!domain) return [];
  const teammates = new Set(
    contacts.filter(
      (address) => address !== ownEmail && emailDomain(address) === domain
    )
  );
  return [...teammates].slice(0, PREFILL_CAP);
}

/**
 * Drops row `index`, keeping at least one (empty) row so the form never loses
 * its input.
 */
export function removeInviteSlot(slots: string[], index: number): string[] {
  const next = slots.filter((_, i) => i !== index);
  return next.length > 0 ? next : [''];
}

/** Deduped, plausible addresses that aren't the user's own. */
export function validInviteEmails(
  slots: string[],
  ownEmail: string | undefined
): string[] {
  return [...new Set(slots.map((value) => value.trim()))].filter(
    (value) => isPlausibleEmail(value) && value !== ownEmail
  );
}
