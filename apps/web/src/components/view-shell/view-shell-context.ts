import type { BreakpointAccessors } from '@app/util/create-size-breakpoints';
import { type Accessor, createContext, useContext } from 'solid-js';
import type {
  AsideLayout,
  AsideMode,
  DetailLayout,
  DetailPlacement,
  MainLayout,
} from './view-shell-layout';

export type ViewShellLayout = {
  width: Accessor<number | undefined>;
  /**
   * Keyed reactive breakpoints from {@link createSizeBreakpoints}.
   * Read as `breakpoints.narrow?.()`, `breakpoints.dense?.()`, …
   */
  breakpoints: BreakpointAccessors;
  aside: {
    layout: Accessor<AsideLayout>;
    mode: Accessor<AsideMode>;
    isCollapsed: Accessor<boolean>;
    canCollapse: Accessor<boolean>;
    isOverlay: Accessor<boolean>;
    isSheet: Accessor<boolean>;
    /** Whether a list aside (`asideList`) fills a narrow shell in place of Main. */
    fillsShell: Accessor<boolean>;
    collapse: () => void;
    expand: () => void;
    toggle: () => void;
  };
  main: {
    layout: Accessor<MainLayout>;
  };
  detail: {
    layout: Accessor<DetailLayout>;
    isOpen: Accessor<boolean>;
    placement: Accessor<DetailPlacement>;
    open: () => void;
    close: () => void;
    toggle: () => void;
  };
};

export type ViewShellInternal = ViewShellLayout & {
  id: string;
  root: Accessor<HTMLDivElement | undefined>;
  atLayoutBreakpoint: Accessor<boolean>;
  asideHost: Accessor<'docked' | 'closing' | 'overlay' | 'sheet'>;
  /** Which of a list aside and Main fills a narrow shell; undefined otherwise. */
  narrowList: Accessor<'list' | 'main' | undefined>;
  returnToList: () => void;
  collectionLayout: Accessor<boolean>;
  navigationTrigger: Accessor<HTMLButtonElement | undefined>;
  registerNavigationTrigger: (element: HTMLButtonElement) => void;
  chooseAsideWidth: (width: number) => void;
};

export const ViewShellContext = createContext<ViewShellInternal>();
export const ViewShellPaneContext = createContext<
  'main' | 'detail' | 'aside'
>();
export const ViewShellReturnToListContext =
  createContext<Accessor<(() => void | Promise<void>) | undefined>>();
export const ViewShellListActiveContext = createContext<Accessor<boolean>>(
  () => true
);

export function useViewShellInternal(): ViewShellInternal {
  const ctx = useContext(ViewShellContext);
  if (!ctx) throw new Error('ViewShell slots require <ViewShell.Root>');
  return ctx;
}

export function useViewShell(): ViewShellLayout {
  const ctx = useViewShellInternal();
  return {
    width: ctx.width,
    breakpoints: ctx.breakpoints,
    aside: ctx.aside,
    main: ctx.main,
    detail: ctx.detail,
  };
}
