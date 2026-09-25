import { emailDomain, isPlausibleEmail } from './shared';

/** How many same-domain teammates get pre-added to the invite list. */
export const PREFILL_CAP = 6;

/**
 * Same-domain teammates worth pre-adding to the invite list: the user's
 * contacts on `domain`, minus themselves, deduped and capped.
 *
 * Empty when the domain isn't team-worthy — the server decides that via
 * `suggested_team_domain`.
 */
export function prefillableTeammates(args: {
  contacts: { email: string }[];
  domain: string | undefined;
  ownEmail: string | undefined;
}): string[] {
  const { contacts, domain, ownEmail } = args;
  if (!domain) return [];
  const teammates = new Set(
    contacts
      .map((contact) => contact.email)
      .filter(
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
