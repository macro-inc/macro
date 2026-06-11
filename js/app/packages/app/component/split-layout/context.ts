import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createContext,
  type Setter,
  type Signal,
} from 'solid-js';
import type { SplitHandle, SplitManager } from './layoutManager';

export type CollapsibleRegistration = {
  id: string;
  priority: number; // lower = higher priority to collapse first
  collapsed: Accessor<boolean>;
  // silent skips onCollapsedChange — used for pre-paint trial measurements
  setCollapsed: (value: boolean, opts?: { silent?: boolean }) => void;
  ref: Accessor<HTMLElement | null | undefined>; // uncollapsed element — measured before collapse
  collapsedRef?: Accessor<HTMLElement | null | undefined>; // collapsed element — measured while collapsed
};

export type CollapsibleItemInput = Omit<
  CollapsibleRegistration,
  'collapsed' | 'setCollapsed'
> & {
  onCollapsedChange?: (isCollapsed: boolean) => void;
};

export type HeaderCollapser = {
  register: (reg: CollapsibleRegistration) => () => void; // returns cleanup
};

export const SplitLayoutContext = createContext<{
  manager: SplitManager;
}>();

export type HalfSplitState = {
  percentage: number;
  side: 'left' | 'right';
};

export type SplitPanelContextType = {
  handle: SplitHandle;
  splitHotkeyScope: string;
  isPanelActive: Accessor<boolean>;
  panelRef: Accessor<HTMLElement | null>;
  panelSize: NullableSize;
  contentOffsetTop: Accessor<number>;
  setContentOffsetTop: Setter<number>;
  halfSplitState?: Accessor<HalfSplitState | undefined>;
  previewState: Signal<boolean>;
  layoutRefs: {
    headerLeft?: HTMLDivElement;
    headerRight?: HTMLDivElement;
    toolbarLeft?: HTMLDivElement;
    toolbarRight?: HTMLDivElement;
  };
  headerCollapser: HeaderCollapser;
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
