import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  type Component,
  createContext,
  type JSX,
  type Setter,
} from 'solid-js';
import type { SplitHandle, SplitManager } from './layoutManager';
import type { PriorityCollapser } from './utils/createPriorityCollapser';

export const SplitLayoutContext = createContext<{
  manager: SplitManager;
}>();

export type SplitBottomPanelRegistration = {
  id: string;
  title?: JSX.Element;
  content: () => JSX.Element;
  onClose?: () => void;
};

export type SplitFileMenuAction = {
  label: string | JSX.Element;
  icon: Component;
  action?: (e?: MouseEvent) => void;
  children?: SplitFileMenuAction[];
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
  bottomPanel: Accessor<SplitBottomPanelRegistration | undefined>;
  registerBottomPanel: (panel: SplitBottomPanelRegistration) => () => void;
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
  headerCollapser: PriorityCollapser;
  toolbarCollapser: PriorityCollapser;
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
