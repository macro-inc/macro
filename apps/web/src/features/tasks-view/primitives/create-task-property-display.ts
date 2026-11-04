import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  readTaskPropertyDisplay,
  type TaskPropertyDisplay,
  type TaskPropertyDisplayMode,
  type TaskPropertyId,
  taskPropertyDisplaySchema,
} from '../core/task-property-display';

const STORAGE_KEY = 'macro:tasks:property-display:v1';

/** Device preferences stay separate from the selected saved view's draft. */
export function createTaskPropertyDisplay(options: {
  userId: Accessor<string | undefined>;
  savedViewActive: Accessor<boolean>;
  saved: Accessor<TaskPropertyDisplay>;
  setSaved: (display: TaskPropertyDisplay) => void;
}) {
  const storage = createUserScopedStorage(STORAGE_KEY);
  const read = (userId: string | undefined) => {
    const raw = userId ? storage.read(userId) : null;
    try {
      return readTaskPropertyDisplay(raw ? JSON.parse(raw) : undefined);
    } catch {
      return { ...DEFAULT_TASK_PROPERTY_DISPLAY };
    }
  };
  const [preferences, setPreferences] = createSignal(read(options.userId()));
  createEffect(
    on(options.userId, (userId) => setPreferences(read(userId)), {
      defer: true,
    })
  );

  const synchronize = (event: Event) => {
    if (event instanceof StorageEvent) {
      const userId = options.userId();
      if (
        event.key === null ||
        event.key === `${STORAGE_KEY}:${encodeURIComponent(userId ?? '')}`
      ) {
        setPreferences(read(userId));
      }
      return;
    }
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (
      typeof detail !== 'object' ||
      detail === null ||
      !('userId' in detail) ||
      !('display' in detail)
    )
      return;
    if (detail.userId === options.userId()) {
      setPreferences(readTaskPropertyDisplay(detail.display));
    }
  };
  window.addEventListener('storage', synchronize);
  window.addEventListener(STORAGE_KEY, synchronize);
  onCleanup(() => {
    window.removeEventListener('storage', synchronize);
    window.removeEventListener(STORAGE_KEY, synchronize);
  });

  const value = () =>
    options.savedViewActive() ? options.saved() : preferences();
  const set = (property: TaskPropertyId, mode: TaskPropertyDisplayMode) => {
    const parsed = taskPropertyDisplaySchema.safeParse({
      ...value(),
      [property]: mode,
    });
    if (!parsed.success) return;
    if (options.savedViewActive()) {
      options.setSaved(parsed.data);
      return;
    }
    setPreferences(parsed.data);
    const userId = options.userId();
    if (!userId) return;
    storage.write(userId, JSON.stringify(parsed.data));
    window.dispatchEvent(
      new CustomEvent(STORAGE_KEY, {
        detail: { userId, display: parsed.data },
      })
    );
  };
  return { value, preferences, set };
}
