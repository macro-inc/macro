import {
  createContext,
  createUniqueId,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createStore, produce, type Store } from 'solid-js/store';

export type NavigationStackEntry<TData> = {
  value: string;
  data: TData;
};

export type NavigationStackState<TData, TNavigateOptions = unknown> = {
  entries: Store<NavigationStackEntry<TData>[]>;
  active: () => NavigationStackEntry<TData> | undefined;
  navigate: (data: TData, options?: TNavigateOptions) => boolean;
  push: (data: TData) => NavigationStackEntry<TData>;
  replace: (data: TData) => NavigationStackEntry<TData>;
  reset: (data: TData) => NavigationStackEntry<TData>;
  pop: () => void;
  popTo: (value: string) => void;
  clear: () => void;
};

type NavigationStackContextValue = NavigationStackState<unknown, unknown>;

const NavigationStackContext = createContext<NavigationStackContextValue>();

export function useMaybeNavigationStack<
  TData = unknown,
  TNavigateOptions = unknown,
>() {
  return useContext(NavigationStackContext) as
    | NavigationStackState<TData, TNavigateOptions>
    | undefined;
}

export function useNavigationStack<
  TData = unknown,
  TNavigateOptions = unknown,
>() {
  const context = useMaybeNavigationStack<TData, TNavigateOptions>();
  if (!context) {
    throw new Error('NavigationStack must be inside <NavigationStack.Root>');
  }
  return context;
}

export type NavigationStackRootProps<
  TData = unknown,
  TNavigateOptions = unknown,
> = ParentProps<{
  defaultValue?: readonly TData[];
  shouldNavigate?: (data: TData, options?: TNavigateOptions) => boolean;
  onChange?: (entries: readonly NavigationStackEntry<TData>[]) => void;
}>;

/** Owns one arbitrary-depth navigation path. */
function Root<TData = unknown, TNavigateOptions = unknown>(
  props: NavigationStackRootProps<TData, TNavigateOptions>
) {
  const rootId = createUniqueId();
  let sequence = 0;
  const createEntry = (data: TData): NavigationStackEntry<TData> => ({
    value: `${rootId}:${sequence++}`,
    data,
  });
  const [entries, setEntries] = createStore<NavigationStackEntry<TData>[]>(
    props.defaultValue?.map(createEntry) ?? []
  );
  const active = () => entries.at(-1);
  const notifyChange = () => props.onChange?.([...entries]);

  const push = (data: TData) => {
    const entry = createEntry(data);
    setEntries(entries.length, entry);
    notifyChange();
    return entry;
  };

  const navigate = (data: TData, options?: TNavigateOptions) => {
    if (props.shouldNavigate?.(data, options) === false) return false;
    push(data);
    return true;
  };

  const replace = (data: TData) => {
    if (entries.length === 0) return push(data);

    const entry = createEntry(data);
    setEntries(
      produce((draft) => {
        draft[draft.length - 1] = entry;
      })
    );
    notifyChange();
    return entry;
  };

  const reset = (data: TData) => {
    const entry = createEntry(data);
    setEntries(
      produce((draft) => {
        draft.splice(0, draft.length, entry);
      })
    );
    notifyChange();
    return entry;
  };

  const pop = () => {
    if (entries.length === 0) return;
    setEntries(
      produce((draft) => {
        draft.pop();
      })
    );
    notifyChange();
  };

  const popTo = (value: string) => {
    const index = entries.findIndex((entry) => entry.value === value);
    if (index < 0 || index === entries.length - 1) return;
    setEntries(
      produce((draft) => {
        draft.splice(index + 1);
      })
    );
    notifyChange();
  };

  const clear = () => {
    if (entries.length === 0) return;
    setEntries(
      produce((draft) => {
        draft.splice(0);
      })
    );
    notifyChange();
  };

  return (
    <NavigationStackContext.Provider
      value={{
        entries: entries as Store<NavigationStackEntry<unknown>[]>,
        active: active as () => NavigationStackEntry<unknown> | undefined,
        navigate: navigate as (data: unknown, options?: unknown) => boolean,
        push: push as (data: unknown) => NavigationStackEntry<unknown>,
        replace: replace as (data: unknown) => NavigationStackEntry<unknown>,
        reset: reset as (data: unknown) => NavigationStackEntry<unknown>,
        pop,
        popTo,
        clear,
      }}
    >
      {props.children}
    </NavigationStackContext.Provider>
  );
}

export type NavigationStackOutletProps<TData, TNavigateOptions = unknown> = {
  children: (
    entry: NavigationStackEntry<TData>,
    state: NavigationStackState<TData, TNavigateOptions>
  ) => JSX.Element;
  fallback?: JSX.Element;
};

/** Keyed rendering disposes the previous entry before mounting the next. */
function Outlet<TData, TNavigateOptions = unknown>(
  props: NavigationStackOutletProps<TData, TNavigateOptions>
) {
  const state = useNavigationStack<TData, TNavigateOptions>();

  return (
    <Show keyed when={state.active()} fallback={props.fallback}>
      {(entry) => <>{props.children(entry, state)}</>}
    </Show>
  );
}

export const NavigationStack = Object.assign(Root, {
  Root,
  Outlet,
});
