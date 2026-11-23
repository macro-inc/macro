import { canonicalContactUserId } from '@queries/contacts/contact-user-id';
import { MAX_CONTACT_LOOKUP } from '@queries/contacts/lookup';
import { createContactResolution } from '@queries/contacts/lookup-query';
import { useContactDirectoryScope } from '@queries/contacts/use-directory';
import { type Accessor, createMemo, mapArray } from 'solid-js';

/** Only document-referenced identities are retained. Each lookup obeys the wire
 * budget; batch owners and their zero-history queries disappear with the refs. */
export function useTaskListAssigneeNames(
  referenced: Accessor<readonly string[]>
) {
  const scope = useContactDirectoryScope();
  const ids = createMemo(
    () =>
      [
        ...new Set(
          referenced().flatMap((value) => {
            const id = canonicalContactUserId(value);
            return id ? [id] : [];
          })
        ),
      ].sort(),
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
    }
  );
  const batches = createMemo(() => {
    const values = ids();
    const result: string[][] = [];
    for (let offset = 0; offset < values.length; offset += MAX_CONTACT_LOOKUP)
      result.push(values.slice(offset, offset + MAX_CONTACT_LOOKUP));
    return result;
  });
  const reads = mapArray(
    batches,
    (values) =>
      createContactResolution(
        scope,
        () => ({ kind: 'ids', values }),
        () => true
      ).data
  );
  const names = createMemo(
    () =>
      new Map(
        reads()
          .flatMap((read) => read()?.users ?? [])
          .map((user) => [user.id, user.name ?? user.email])
      )
  );
  return (id: string) => names().get(id.toLowerCase()) ?? 'Unknown';
}
