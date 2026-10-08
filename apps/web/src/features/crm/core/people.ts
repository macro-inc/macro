import type { CrmContact } from './contact';

export type CrmPerson = CrmContact & { companyName: string };

/** The fields that choose one visible record for a contact email. */
export type ContactRepresentative = {
  id: string;
  email: string;
  hidden: boolean;
  lastInteraction?: string | null;
};

export const interactionTime = (contact: ContactRepresentative) =>
  Date.parse(contact.lastInteraction ?? '') || 0;

/** A representative can change between server pages; keep one visible row per
 * email: the latest interaction, then the greatest record id. */
export function deduplicatePeople<T extends ContactRepresentative>(
  people: T[]
): T[] {
  const byEmail = new Map<string, T>();
  for (const person of people) {
    if (person.hidden) continue;
    const email = person.email.trim().toLowerCase();
    const previous = byEmail.get(email);
    if (
      !previous ||
      interactionTime(person) > interactionTime(previous) ||
      (interactionTime(person) === interactionTime(previous) &&
        person.id > previous.id)
    ) {
      byEmail.set(email, person);
    }
  }
  return [...byEmail.values()];
}
