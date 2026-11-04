import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { z } from 'zod';

// Not makePersistedState: the canonical tab state (live layout, capture
// objects) differs from the saved projection (URLs), so the manager derives
// what to write instead of persisting a signal one-to-one.

const persistedTabSchema = z.object({
  title: z.string().optional(),
  paneCount: z.number().int().min(1),
  url: z.string().min(1),
});

const persistedTabsSchema = z.object({
  version: z.literal(1),
  active: z.number().int().min(0),
  tabs: z.array(persistedTabSchema).min(1),
});

export type PersistedTabs = z.infer<typeof persistedTabsSchema>;

const storage = createUserScopedStorage('macro:desktop:tabs');

export function readPersistedTabs(userId: string): PersistedTabs | undefined {
  const raw = storage.read(userId);
  if (!raw) return;

  try {
    const parsed = persistedTabsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;

    return parsed.data;
  } catch {
    return;
  }
}

export function writePersistedTabs(userId: string, value: PersistedTabs) {
  storage.write(userId, JSON.stringify(value));
}
