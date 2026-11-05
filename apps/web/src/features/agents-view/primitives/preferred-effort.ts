import type { EffortChoice } from '@app/features/block-agent/state/session-config';
import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import { z } from 'zod';

const PREFERRED_EFFORTS_SCHEMA = z.record(
  z.string(),
  z.object({ configId: z.string(), value: z.string(), name: z.string() })
);

type PreferredEfforts = z.infer<typeof PREFERRED_EFFORTS_SCHEMA>;

/**
 * The last effort chosen in the New conversation composer for each agent
 * runtime and model. Scoped to the signed-in user so new conversations keep
 * starting on that effort until another one is picked.
 */
export function createPreferredEffort(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-view-effort-v1');
  const [efforts, setEfforts] = makePersistedState(
    createSignal<PreferredEfforts>({}),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const stored = storage.read(userId);
          if (!stored) return;
          try {
            const parsed = PREFERRED_EFFORTS_SCHEMA.safeParse(
              JSON.parse(stored)
            );
            return parsed.success ? parsed.data : undefined;
          } catch {
            return undefined;
          }
        },
        write: (value) => {
          if (!userId) return;
          storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );

  return {
    /** The remembered effort for one `target` (a serialized runtime and model). */
    effort: (target: string): EffortChoice | undefined => efforts()[target],
    remember: (target: string, choice: EffortChoice) =>
      setEfforts((current) => ({
        ...current,
        [target]: {
          configId: choice.configId,
          value: choice.value,
          name: choice.name,
        },
      })),
  };
}
