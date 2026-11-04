import type { TaskComposerContext } from '@app/features/task-composer/core/context';
import {
  type Accessor,
  createContext,
  createSignal,
  type ParentProps,
  untrack,
  useContext,
} from 'solid-js';

/** Each create action owns its plain, cloneable defaults. */
export type CreateContextByAction = {
  task: TaskComposerContext;
};

/** Omitted actions inherit; null explicitly clears an inherited preset. */
export type PaneCreateContext = {
  [Action in keyof CreateContextByAction]?:
    | CreateContextByAction[Action]
    | null;
};

type CreateContext = {
  register: (paneId: string, source: Accessor<PaneCreateContext>) => () => void;
  read: <Action extends keyof CreateContextByAction>(
    action: Action,
    paneId?: string
  ) => CreateContextByAction[Action] | undefined;
  snapshot: <Action extends keyof CreateContextByAction>(
    action: Action,
    paneId?: string
  ) => CreateContextByAction[Action] | undefined;
};

type Registration = {
  paneId: string;
  source: Accessor<PaneCreateContext>;
};

const CreateContext = createContext<CreateContext>();

/** Own registrations locally; the host supplies its existing focus accessor. */
export function CreateContextProvider(
  props: ParentProps<{ focusedPaneId: Accessor<string | undefined> }>
) {
  const [registrations, setRegistrations] = createSignal<Registration[]>([]);

  const context: CreateContext = {
    register(paneId, source) {
      const registration = { paneId, source };
      setRegistrations((entries) => [...entries, registration]);
      return () => {
        setRegistrations((entries) =>
          entries.filter((entry) => entry !== registration)
        );
      };
    },
    read(action, paneId) {
      const id = paneId ?? props.focusedPaneId();
      if (id === undefined) return;
      const entries = registrations();
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (entry.paneId !== id) continue;
        const value = entry.source()[action];
        if (value !== undefined) return value ?? undefined;
      }
    },
    snapshot(action, paneId) {
      return untrack(() => {
        const value = context.read(action, paneId);
        return value === undefined ? undefined : structuredClone(value);
      });
    },
  };

  return (
    <CreateContext.Provider value={context}>
      {props.children}
    </CreateContext.Provider>
  );
}

export function useCreateContext(): CreateContext {
  const context = useContext(CreateContext);
  if (!context)
    throw new Error('useCreateContext requires CreateContextProvider');
  return context;
}
