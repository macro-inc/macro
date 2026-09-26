import type { EntryPersistenceHandle } from '@components/app/split-layout/entry-persistence';
import { type Accessor, onCleanup } from 'solid-js';
import { z } from 'zod';
import type { ProjectCollectionSnapshot } from './primitives/project-collection';

const ENTRY_KEY = 'initiatives.collection';
const snapshotSchema = z.object({
  search: z.string(),
  status: z.string(),
  priority: z.string(),
  dueBefore: z.string(),
  dueAfter: z.string(),
  mine: z.boolean(),
  sort: z.enum(['updated', 'name', 'due']),
  groupBy: z.enum(['none', 'status', 'priority', 'assignee']),
  scrollOffset: z.number().finite().nonnegative(),
  collapsedGroupIds: z.array(z.string()),
  focusKey: z.string().optional(),
});

/** Shares the split entry lifecycle used by the Tasks list. */
export function createProjectCollectionPersistence(
  handle: EntryPersistenceHandle
) {
  const stored = snapshotSchema.safeParse(
    handle.currentEntryState()?.[ENTRY_KEY]
  );
  return {
    initialState: stored.success ? stored.data : undefined,
    captureState(read: Accessor<ProjectCollectionSnapshot>) {
      onCleanup(handle.registerEntryStateCaptor(ENTRY_KEY, read));
    },
  };
}
