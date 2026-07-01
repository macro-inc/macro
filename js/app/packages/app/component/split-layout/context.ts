import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  type Component,
  createContext,
  type JSX,
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

export type SplitBottomPanelRegistration = {
  id: string;
  title?: JSX.Element;
  content: () => JSX.Element;
  onClose?: () => void;
};

export type SplitFileMenuAction = {
  label: string | JSX.Element;
  icon: Component;
  action: (e?: MouseEvent) => void;
  group?: 'delete';
};

export type SplitFileMenuActionGroups = {
  primaryOps: SplitFileMenuAction[];
  tools: SplitFileMenuAction[];
  deleteOps: SplitFileMenuAction[];
};

export type SplitFileMenuActionSection = {
  key: keyof SplitFileMenuActionGroups;
  actions: SplitFileMenuAction[];
};

export function getSplitFileMenuActionSections(
  groups: SplitFileMenuActionGroups
): SplitFileMenuActionSection[] {
  const sections: SplitFileMenuActionSection[] = [
    { key: 'tools', actions: groups.tools },
    { key: 'primaryOps', actions: groups.primaryOps },
    { key: 'deleteOps', actions: groups.deleteOps },
  ];

  return sections.filter((section) => section.actions.length > 0);
}

export type SplitPanelContextType = {
  handle: SplitHandle;
  splitHotkeyScope: string;
  isPanelActive: Accessor<boolean>;
  panelRef: Accessor<HTMLElement | null>;
  panelSize: NullableSize;
  contentOffsetTop: Accessor<number>;
  setContentOffsetTop: Setter<number>;
  halfSplitState?: Accessor<HalfSplitState | undefined>;
  bottomPanel: Accessor<SplitBottomPanelRegistration | undefined>;
  registerBottomPanel: (panel: SplitBottomPanelRegistration) => () => void;
  previewState: Signal<boolean>;
  layoutRefs: {
    headerLeft?: HTMLDivElement;
    headerRight?: HTMLDivElement;
    toolbarLeft?: HTMLDivElement;
    toolbarRight?: HTMLDivElement;
  };
  titleFileMenuRef: Accessor<HTMLDivElement | undefined>;
  setTitleFileMenuRef: Setter<HTMLDivElement | undefined>;
  titleFileMenuTrigger: Accessor<(() => void) | undefined>;
  setTitleFileMenuTrigger: Setter<(() => void) | undefined>;
  titleFileMenuActions: Accessor<SplitFileMenuActionGroups | undefined>;
  setTitleFileMenuActions: Setter<SplitFileMenuActionGroups | undefined>;
  headerCollapser: HeaderCollapser;
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
