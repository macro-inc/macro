import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal, onCleanup } from 'solid-js';
import { z } from 'zod';
import type { FeedPreferences } from '../context/feed-source';

const preferencesSchema = z.object({
  prompt: z.string().max(4000).optional(),
  hiddenIds: z.array(z.string()).max(500),
});

/** Local preferences are scoped to the authenticated account, never shared between users. */
export function createFeedPreferences(
  userId: string,
  defaultPrompt: string
): FeedPreferences {
  const storage = createUserScopedStorage('for-you-preferences-v1');
  let initial: z.infer<typeof preferencesSchema> = { hiddenIds: [] };
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
  const onChange = (event: Event) => {
    if (event instanceof CustomEvent) {
      const parsed = z
        .object({ userId: z.string(), preferences: preferencesSchema })
        .safeParse(event.detail);
      if (parsed.success && parsed.data.userId === userId)
        setPreferences(parsed.data.preferences);
    } else if (
      event instanceof StorageEvent &&
      event.key === `for-you-preferences-v1:${encodeURIComponent(userId)}`
    ) {
      try {
        const parsed = preferencesSchema.safeParse(
          JSON.parse(event.newValue ?? '{"hiddenIds":[]}')
        );
        if (parsed.success) setPreferences(parsed.data);
      } catch {
        // Ignore malformed data from another tab.
      }
    }
  };
  window.addEventListener('for-you-preferences-changed', onChange);
  window.addEventListener('storage', onChange);
  onCleanup(() => {
    window.removeEventListener('for-you-preferences-changed', onChange);
    window.removeEventListener('storage', onChange);
  });
  const update = (next: typeof initial) => {
    setPreferences(next);
    storage.write(userId, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('for-you-preferences-changed', {
        detail: { userId, preferences: next },
      })
    );
  };
  return {
    prompt: () => preferences().prompt ?? defaultPrompt,
    hiddenIds: () => preferences().hiddenIds,
    setPrompt: (prompt) => update({ ...preferences(), prompt }),
    setHiddenIds: (hiddenIds) =>
      update({ ...preferences(), hiddenIds: hiddenIds.slice(-500) }),
  };
}
