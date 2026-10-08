import type { CrmContact } from './contact';

export type CrmPerson = CrmContact & { companyName: string };
export type PeopleSort =
  | 'name'
  | 'companyName'
  | 'lastInteraction'
  | 'firstInteraction';

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

export function filterAndSortPeople(
  people: CrmPerson[],
  search: string,
  sort: PeopleSort,
  descending: boolean
) {
  const term = search.trim().toLowerCase();
  return people
    .filter(
      (person) =>
        !person.hidden &&
        [person.name, person.email, person.companyName].some((value) =>
          value?.toLowerCase().includes(term)
        )
    )
    .sort((a, b) => {
      const left = sort === 'name' ? a.name || a.email : a[sort];
      const right = sort === 'name' ? b.name || b.email : b[sort];
      const order =
        sort === 'lastInteraction' || sort === 'firstInteraction'
          ? (Date.parse(left) || 0) - (Date.parse(right) || 0)
          : left.localeCompare(right, undefined, { sensitivity: 'base' });
      return (descending ? -order : order) || a.id.localeCompare(b.id);
    });
}
