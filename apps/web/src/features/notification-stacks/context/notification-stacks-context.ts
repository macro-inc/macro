import {
  type Accessor,
  type Component,
  createContext,
  useContext,
} from 'solid-js';
import type {
  Stack,
  StackEntityKind,
  StackRule,
  StackRules,
} from '../core/stack';

/** The reader's stacks, in the order they are tried. */
export type StacksState =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'ready'; stacks: readonly Stack[] };

/** Changes to a stack; a field left out keeps its value. */
export type StackChanges = {
  name?: string;
  capture?: readonly StackRule[];
  release?: readonly StackRule[];
  enabled?: boolean;
};

/** The reader's stacks and the writes on them; each write rejects when it fails. */
export type StacksSource = {
  state: Accessor<StacksState>;
  /** Read the stacks again after a failed load. */
  retry: () => void;
  create: (name: string, rules: StackRules) => Promise<Stack>;
  update: (id: string, changes: StackChanges) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** `ids` names every stack once, first tried first. */
  reorder: (ids: readonly string[]) => Promise<void>;
};

export type NotificationStacksContext = {
  stacks: StacksSource;
  /** The icon and name of a channel, document, folder, task project or person. */
  EntityLabel: Component<{ kind: StackEntityKind; id: string }>;
  /**
   * Search and pick entities of one kind. `fill` lets the list fill a sized
   * container such as a sheet.
   */
  EntityPicker: Component<{
    kind: StackEntityKind;
    ids: readonly string[];
    onChange: (ids: string[]) => void;
    fill?: boolean;
  }>;
};

const Context = createContext<NotificationStacksContext>();

export const NotificationStacksProvider = Context.Provider;

export function useNotificationStacksContext(): NotificationStacksContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error(
      'useNotificationStacksContext needs a NotificationStacksProvider'
    );
  }
  return context;
}
