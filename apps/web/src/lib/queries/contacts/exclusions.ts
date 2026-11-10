import { MAX_PEOPLE_BATCH } from '@graphql-cache/people/generated';
import { hashKey } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { canonicalContactUserId } from './contact-user-id';

/** Scoped rosters may exceed the IPC budget. Send a bounded prefix, filter the
 * remainder locally, and bind paging to the complete eligibility set. */
export function createContactExclusions(
  roster: Accessor<Iterable<string>>,
  self: Accessor<string | undefined>
) {
  const ids = createMemo(() => {
    const values = new Set<string>();
    const viewer = self();
    if (viewer) values.add(viewer);
    for (const value of roster()) {
      const id = canonicalContactUserId(value);
      if (id) values.add(id);
    }
    return values;
  });
  const native = createMemo(() => {
    const values: string[] = [];
    for (const id of ids()) {
      if (values.length === MAX_PEOPLE_BATCH) break;
      values.push(id);
    }
    return values;
  });
  return { ids, native, key: createMemo(() => hashKey([[...ids()].sort()])) };
}
