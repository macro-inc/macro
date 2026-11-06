import {
  type Accessor,
  createContext,
  createRoot,
  type JSX,
  type Owner,
  onCleanup,
  useContext,
} from 'solid-js';
import { createStore, produce, type Store } from 'solid-js/store';

type EntryBase = {
  sequence: number;
  /** Group key. Root orders listed sections first; the rest follow in first-registration order. */
  section: string | undefined;
};

export type ActionMenuItemEntry = EntryBase & {
  kind: 'item';
  disabled: Accessor<boolean>;
  onSelect: (event?: Event) => void;
  /** Creates the row content under the declaring item's owner. Call once per render site. */
  content: () => JSX.Element;
};

export type ActionMenuSubEntry = EntryBase & {
  kind: 'sub';
  label: () => JSX.Element;
  /** The submenu's own sections, memoized by the Sub. */
  sections: Accessor<ActionMenuSection[]>;
};

export type ActionMenuEntry = ActionMenuItemEntry | ActionMenuSubEntry;

export type ActionMenuEntryInput =
  | Omit<ActionMenuItemEntry, 'sequence'>
  | Omit<ActionMenuSubEntry, 'sequence'>;

export type ActionMenuSection = {
  key: string | undefined;
  entries: ActionMenuEntry[];
};

export type ActionMenuRegistry = {
  entries: Store<ActionMenuEntry[]>;
  register: (entry: ActionMenuEntryInput) => () => void;
};

/** The menu an item or surface sits in: the Root, or a Sub sharing the Root's open state. */
export type ActionMenuState = ActionMenuRegistry & {
  sections: Accessor<ActionMenuSection[]>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
};

export function createActionMenuRegistry(): ActionMenuRegistry {
  const [entries, setEntries] = createStore<ActionMenuEntry[]>([]);
  let sequence = 0;

  const register: ActionMenuRegistry['register'] = (entry) => {
    const registered = { ...entry, sequence: sequence++ } as ActionMenuEntry;
    setEntries(produce((draft) => void draft.push(registered)));

    return () => {
      setEntries(
        produce((draft) => {
          const index = draft.findIndex(
            (item) => item.sequence === registered.sequence
          );
          if (index >= 0) draft.splice(index, 1);
        })
      );
    };
  };

  return { entries, register };
}

function isVisible(entry: ActionMenuEntry): boolean {
  if (entry.kind === 'item') return true;
  return entry.sections().length > 0;
}

/** Groups visible entries by section: listed sections in order, then the rest as first registered. */
export function sectionsOf(
  entries: readonly ActionMenuEntry[],
  order: readonly string[] = []
): ActionMenuSection[] {
  const groups = new Map<string | undefined, ActionMenuEntry[]>();
  for (const key of order) groups.set(key, []);

  const visible = [...entries]
    .filter(isVisible)
    .sort((left, right) => left.sequence - right.sequence);
  for (const entry of visible) {
    const group = groups.get(entry.section);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.section, [entry]);
    }
  }

  return [...groups]
    .filter(([, group]) => group.length > 0)
    .map(([key, group]) => ({ key, entries: group }));
}

/**
 * Runs `render` under `owner` so the content keeps the declaring component's
 * providers, while its lifetime follows the menu that called it.
 */
export function renderOwned(
  owner: Owner | null,
  render: () => JSX.Element
): JSX.Element {
  let dispose!: () => void;
  const content = createRoot((cleanup) => {
    dispose = cleanup;
    return render();
  }, owner);
  onCleanup(dispose);
  return content;
}

export const ActionMenuContext = createContext<ActionMenuState>();

export function useActionMenu(): ActionMenuState {
  const menu = useContext(ActionMenuContext);
  if (!menu) {
    throw new Error(
      'ActionMenu parts must be inside <ActionMenu.Root> or <ActionMenu.Sub>'
    );
  }
  return menu;
}

/** The given menu, else the enclosing one. Lets a shared drawer render another Root. */
export function useProvidedActionMenu(
  provided: Accessor<ActionMenuState | undefined>
): Accessor<ActionMenuState> {
  const enclosing = useContext(ActionMenuContext);
  return () => {
    const menu = provided() ?? enclosing;
    if (!menu) {
      throw new Error(
        'ActionMenu menus need a `menu` prop or an enclosing <ActionMenu.Root>'
      );
    }
    return menu;
  };
}
