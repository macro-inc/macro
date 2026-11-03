import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import type { FeedPreferences } from '../context/feed-source';

const preferencesSchema = z.object({
  prompt: z.string().max(4000),
  hiddenIds: z.array(z.string()).max(500),
});

/** Local preferences are scoped to the authenticated account, never shared between users. */
export function createFeedPreferences(
  userId: string,
  defaultPrompt: string
): FeedPreferences {
  const storage = createUserScopedStorage('for-you-preferences-v1');
  let initial = { prompt: defaultPrompt, hiddenIds: [] as string[] };
  const raw = storage.read(userId);
  if (raw) {
    try {
      const parsed = preferencesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) initial = parsed.data;
    } catch {
      // A corrupt preference must not prevent the live feed from loading.
    }
  }
  const [preferences, setPreferences] = createSignal(initial);
  const update = (next: typeof initial) => {
    setPreferences(next);
    storage.write(userId, JSON.stringify(next));
  };
  return {
    prompt: () => preferences().prompt,
    hiddenIds: () => preferences().hiddenIds,
    setPrompt: (prompt) => update({ ...preferences(), prompt }),
    setHiddenIds: (hiddenIds) =>
      update({ ...preferences(), hiddenIds: hiddenIds.slice(-500) }),
  };
}
