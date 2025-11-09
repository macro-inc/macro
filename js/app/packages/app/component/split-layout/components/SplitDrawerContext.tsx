import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createContext,
  createSignal,
  type ParentProps,
  type Setter,
  type Signal,
  useContext,
} from 'solid-js';
import { useSplitPanel } from '../layoutUtils';

interface ISplitDrawerContext {
  activeDrawer: () => string | null;
  openDrawer: (id: string) => boolean;
  closeDrawer: (id: string) => boolean;
  isDrawerOpen: (id: string) => boolean;
  panelSize: NullableSize;
  contentOffsetTop: Accessor<number>;
}

export const SplitDrawerContext = createContext<ISplitDrawerContext>();

export function SplitDrawerGroup(
  props: ParentProps<{
    panelSize: NullableSize;
    contentOffsetTop: Accessor<number>;
  }>
) {
  const [currentDrawer, setCurrentDrawer] = createSignal<string | null>(null);
  const panel = useSplitPanel();

  // drop all drawers on split nav
  panel?.handle.registerContentChangeListener(() => {
    setCurrentDrawer(null);
  });

  const openDrawer = (id: string) => {
    const current = currentDrawer();
    if (id !== current) {
      setCurrentDrawer(id);
      return true;
    }
    return false;
  };

  const closeDrawer = (id: string) => {
    const current = currentDrawer();
    if (current === id) {
      setCurrentDrawer(null);
      return true;
    }
    return false;
  };

  const isDrawerOpen = (id: string) => currentDrawer() === id;

  return (
    <SplitDrawerContext.Provider
      value={{
        activeDrawer: () => currentDrawer() ?? null,
        openDrawer,
        closeDrawer,
        isDrawerOpen,
        panelSize: props.panelSize,
        contentOffsetTop: props.contentOffsetTop,
      }}
    >
      {props.children}
    </SplitDrawerContext.Provider>
  );
}

/**
 * Create a boolean signal for a drawer open state. Internally uses context to
 * make sure only one drawer in the group is open at a time. This can be used
 * as drop in replacement for regular createSignal. If used inside a
 * SplitDrawerGroup then you'll get a "smart" signal that will close
 * any other drawer in the group when this drawer is opened. If called outside the
 * context falls back to a regular signal. In the group, it is possible to call
 * `setter(true)` and have the signal still read false if a higher priority
 * drawer is open.
 * @example
 * // in MySplitDrawer.tsx: replace -
 * const [isOpen, setIsOpen] = createSignal(false);
 * // with this. Simpler tracking of keeping only one drawer open.
 * const [isOpen, setIsOpen] = createDrawerOpenSignal('my-drawer', DrawerPriority.Low, false);
 *
 * @param id A unique identifier for the drawer within its context.
 * @param priority The priority of the drawer. A drawer with a lower priority will
 *     not be allowed to open if another drawer is already open. In the case of a
 *     tie, the newer drawer wins.
 * @returns Signal<boolean> - A signal that can be used like any other boolean signal
 */
export function createDrawerOpenSignal(
  id: string,
  initial?: boolean
): Signal<boolean> {
  const context = useContext(SplitDrawerContext);
  if (!context) {
    throw new Error(
      'createDrawerOpenSignal must be used within a SplitDrawerContext'
    );
  }

  let state = initial ?? false;
  if (state) {
    const success = context.openDrawer(id);
    state = success;
  }

  const getter: Accessor<boolean> = () => context.isDrawerOpen(id);

  const setter: Setter<boolean> = (
    value: boolean | ((prev: boolean) => boolean)
  ) => {
    if (typeof value === 'function') {
      const next = value(state);
      if (next !== state) {
        if (next === true) {
          state = context.openDrawer(id);
        } else {
          state = context.closeDrawer(id);
        }
      }
    } else {
      if (value === true) {
        state = context.openDrawer(id);
      } else if (value === false) {
        state = context.closeDrawer(id);
      }
    }
    return state;
  };
  return [getter, setter];
}

/**
 * Hook to control a managed split drawer from outside the component.
 * Use this when you need to programmatically open/close a drawer.
 */
export function useDrawerControl(id: string) {
  const [open, setOpen] = createDrawerOpenSignal(id, false);
  return {
    isOpen: open,
    toggle: () => setOpen(!open()),
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
}

export function useDrawerGroup() {
  const ctx = useContext(SplitDrawerContext);
  if (!ctx) {
    throw new Error('useDrawerGroup must be used within a SplitDrawerContext');
  }
  return ctx;
}
