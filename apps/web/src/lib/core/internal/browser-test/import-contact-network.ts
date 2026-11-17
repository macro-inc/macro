import { contactRecordKey } from '@queries/contacts/contact-key';
import type { ContactReferencePageQueryVariables } from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';

const viewer = 'macro|viewer@example.com';
const people = [
  {
    userId: 'macro|person99999@example.com',
    email: 'person99999@example.com',
    name: 'Private late name',
  },
  {
    userId: 'macro|comma@example.com',
    email: 'comma@example.com',
    name: 'Family, Given',
  },
  {
    userId: 'macro|shared1@example.com',
    email: 'shared1@example.com',
    name: 'Shared Name',
  },
  {
    userId: 'macro|shared2@example.com',
    email: 'shared2@example.com',
    name: 'Shared Name',
  },
  {
    userId: 'macro|alias@example.com',
    email: 'alias@example.com',
    name: 'target@example.com',
  },
];
const row = (person: (typeof people)[number]) => ({
  ...person,
  id: contactRecordKey(viewer, person.userId).slice('GraphqlContact:'.length),
});
export const [importReferenceReads, setImportReferenceReads] = createSignal<
  ContactReferencePageQueryVariables[]
>([]);
export const [importLookupReads, setImportLookupReads] = createSignal<
  readonly string[]
>([]);
let gate: PromiseWithResolvers<void> | undefined;
export function holdImportReferences() {
  gate ??= Promise.withResolvers<void>();
}
export function releaseImportReferences() {
  gate?.resolve();
  gate = undefined;
}
export async function fetchImportReferences(
  input: ContactReferencePageQueryVariables,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  setImportReferenceReads((requests) => [...requests, input]);
  if (gate) await gate.promise;
  signal.throwIfAborted();
  return {
    user: {
      id: viewer,
      contacts: {
        nodes: input.after
          ? people
              .filter(
                (person) =>
                  person.name.toLowerCase() === input.search?.toLowerCase()
              )
              .map(row)
          : [],
        nextCursor: input.after ? null : 'after-empty-budget',
      },
    },
  };
}
export async function fetchImportIds(ids: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  setImportLookupReads(ids);
  const records = ids.flatMap((id) => {
    const known = people.find((person) => person.userId === id);
    if (known) return [row(known)];
    if (id === viewer || /^macro\|person\d+@example\.com$/.test(id))
      return [
        row({
          userId: id,
          email: id.slice(6),
          name:
            id === viewer ? 'Viewer' : `Person ${id.slice(12).split('@')[0]}`,
        }),
      ];
    return [];
  });
  return { user: { id: viewer, contactsByUserIds: records } };
}
