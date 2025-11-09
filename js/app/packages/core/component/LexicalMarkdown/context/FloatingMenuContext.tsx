import {
  type Accessor,
  createContext,
  createSignal,
  type ParentProps,
  type Setter,
  type Signal,
  useContext,
} from 'solid-js';

export const MenuPriority = {
  Default: 1,
  Low: 5,
  Normal: 10,
  High: 15,
  Critical: 20,
} as const;

interface IFloatingMenuContext {
  activeMenu: () => string | null;
  openMenu: (id: string, priority: number) => boolean;
  closeMenu: (id: string) => false;
  isMenuOpen: (id: string) => boolean;
}

export const FloatingMenuContext = createContext<IFloatingMenuContext>();

export function FloatingMenuGroup(props: ParentProps) {
  const [currentMenu, setCurrentMenu] = createSignal<{
    id: string;
    priority: number;
  } | null>(null);

  const openMenu = (id: string, priority: number) => {
    const current = currentMenu();
    if (!current || priority >= current.priority) {
      setCurrentMenu({ id, priority });
      return true;
    }
    return false;
  };

  const closeMenu = (id: string) => {
    const current = currentMenu();
    if (current?.id === id) {
      setCurrentMenu(null);
    }
    return false as false;
  };

  const isMenuOpen = (id: string) => currentMenu()?.id === id;

  return (
    <FloatingMenuContext.Provider
      value={{
        activeMenu: () => currentMenu()?.id ?? null,
        openMenu,
        closeMenu,
        isMenuOpen,
      }}
    >
      {props.children}
    </FloatingMenuContext.Provider>
  );
}

/**
 * Create a boolean signal for a menu open state. Internally uses context to
 * make sure only one menu in the group is open at a time. This can be used
 * as drop in replacement for regular createSignal. If used inside a
 * FloatingMenuGroup group then you'll get a "smart" signal that will close
 * any other menu in the group when this menu is opened. If called outside the
 * context falls back to a regular signal. In the group, it is possible to call
 * `setter(true)` and have the signal still read false if a higher priority
 * menu is open.
 * @example
 * // in MyFloatingMenu.tsx: replace -
 * const [isOpen, setIsOpen] = createSignal(false);
 * // wit this. Simpler tracking of keeping only one menu open.
 * const [isOpen, setIsOpen] = createMenuOpenSignal('my-menu', MenuPriority.Low, false);
 *
 * @param id A unique identifier for the menu within its context.
 * @param priority The priority of the menu. A menu with a lower priority will
 *     not be allowed to open if another menu is already open. In the case of a
 *     tie, the newer menu wins.
 * @throws Error if FloatingMenuContext is not available.
 * @returns
 */
export function createMenuOpenSignal(
  id: string,
  priority: number,
  initial?: boolean
): Signal<boolean> {
  const context = useContext(FloatingMenuContext);
  if (!context) {
    console.warn(
      'createMenuOpenSignal called outside of <FloatingMenuGroup>. Falling back to plain signal. This may not be what you want.'
    );
    return createSignal(initial ?? false);
  }

  let state = initial ?? false;
  if (state) {
    const success = context.openMenu(id, priority);
    state = success;
  }

  const getter: Accessor<boolean> = () => context.isMenuOpen(id);

  const setter: Setter<boolean> = (
    value: boolean | ((prev: boolean) => boolean)
  ) => {
    if (typeof value === 'function') {
      const next = value(state);
      if (next !== state) {
        if (next === true) {
          state = context.openMenu(id, priority);
        } else {
          state = context.closeMenu(id);
        }
      }
    } else {
      if (value === true) {
        state = context.openMenu(id, priority);
      } else if (value === false) {
        state = context.closeMenu(id);
      }
    }
    return state;
  };
  return [getter, setter];
}
