import { makePersistedState } from '@app/lib/persistence';
import { deepEqual } from '@core/util/compareUtils';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  untrack,
} from 'solid-js';
import type { z } from 'zod';

/**
 * `current()` once it is known; until then, the value this browser last saw
 * for the signed-in user. Cards read their flags and queries through this so
 * a remount (switching views, reloading) renders the settled card at once
 * instead of waiting on the network. `undefined` only when neither is known.
 */
export function createLastKnown<T>(
  key: string,
  userId: string | undefined,
  current: Accessor<T | undefined>,
  schema: z.ZodType<T>
): Accessor<T | undefined> {
  const storage = createUserScopedStorage(
    `sidebar-promotion:last-known:v1:${key}`
  );
  const [last, setLast] = makePersistedState(
    createSignal<T | undefined>(undefined),
    {
      storages: {
        restore: () => {
          const raw = userId ? storage.read(userId) : null;
          if (raw === null) return;
          const parsed = schema.safeParse(JSON.parse(raw));
          return parsed.success ? parsed.data : undefined;
        },
        write: (value) => {
          if (userId && value !== undefined)
            storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );
  // Remember each settled value; local storage is the external system here.
  createEffect(
    on(current, (value) => {
      if (value !== undefined && !deepEqual(value, untrack(last)))
        setLast(() => value);
    })
  );
  return () => {
    const value = current();
    return value === undefined ? last() : value;
  };
}
