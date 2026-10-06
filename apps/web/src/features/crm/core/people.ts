import type { CrmContact } from './contact';

export type CrmPerson = CrmContact & { companyName: string };
export type PeopleSort =
  | 'name'
  | 'companyName'
  | 'lastInteraction'
  | 'firstInteraction';

/** A representative can change between server pages; keep one visible row per email. */
export function deduplicatePeople(people: CrmPerson[]): CrmPerson[] {
  const byEmail = new Map<string, CrmPerson>();
  for (const person of people) {
    if (person.hidden) continue;
    const email = person.email.trim().toLowerCase();
    const previous = byEmail.get(email);
    if (
      !previous ||
      Date.parse(person.lastInteraction) >
        Date.parse(previous.lastInteraction) ||
      (Date.parse(person.lastInteraction) ===
        Date.parse(previous.lastInteraction) &&
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
