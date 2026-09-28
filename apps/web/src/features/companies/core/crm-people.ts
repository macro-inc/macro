import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';

export type CrmPerson = CrmContactResponse & { companyName: string };
export type PeopleSort =
  | 'name'
  | 'companyName'
  | 'lastInteraction'
  | 'firstInteraction';

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
