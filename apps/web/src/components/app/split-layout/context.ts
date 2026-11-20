import type { HotkeyToken } from '@core/hotkey/tokens';
import { MENU_GROUP_ORDER, type MenuGroup } from '@core/menu/group-menu-items';
import type { NotificationMuteMenuProps } from '@notifications/components/NotificationMuteMenu';
import type { NotificationSettingsMenuProps } from '@notifications/components/NotificationSettingsMenu';
import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  type Component,
  createContext,
  type JSX,
  type Setter,
  type Signal,
} from 'solid-js';
import type { PriorityCollapser } from '../../priority-collapse/createPriorityCollapser';
import type { SplitHandle, SplitManager } from './layoutManager';
import type { ReplaceOwnedSlot } from './utils/createOwnedSlots';

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
  /** Stable identity for a row while its metadata changes. */
  id?: string;
  /** Semantic order is separate from the unique rendered row identity. */
  orderKey?: string;
  label: string | JSX.Element;
  disabledReason?: string;
  icon?: Component;
  action?: (e?: MouseEvent) => void | Promise<unknown>;
  /** Destructive presentation chosen by the action owner. */
  danger?: boolean;
  /** Clipboard actions acknowledge completion inline without dismissing the menu. */
  copy?: boolean;
  children?: SplitFileMenuAction[];
  muteMenu?: NotificationMuteMenuProps;
  notificationSettingsMenu?: NotificationSettingsMenuProps;
  /** Desktop-only composed item, such as an entity picker submenu. */
  menuItem?: Component<{ onActionComplete?: () => void; menu?: 'dropdown' }>;
  /** Only set when the token's shortcut is executable from the split. */
  hotkeyToken?: HotkeyToken;
  group?: SplitFileMenuActionGroup;
};

/** Shared action sections used by the title menu and phone header. */
export type SplitFileMenuActionGroups = Record<
  MenuGroup,
  SplitFileMenuAction[]
>;

export type SplitFileMenuActionGroup = MenuGroup;

export type SplitFileMenuActionSection = {
  key: keyof SplitFileMenuActionGroups;
  actions: SplitFileMenuAction[];
};

export function getSplitFileMenuActionSections(
  groups: SplitFileMenuActionGroups
): SplitFileMenuActionSection[] {
  const sections = MENU_GROUP_ORDER.map((key) => ({
    key,
    actions: groups[key],
  }));

  return sections.filter((section) => section.actions.length > 0);
}

export type SplitPanelContextType = {
  handle: SplitHandle;
  splitHotkeyScope: string;
  /** Whether mounted block content is rendered in a passive inline preview. */
  isInlinePreview?: boolean;
  isPanelActive: Accessor<boolean>;
  panelRef: Accessor<HTMLElement | null>;
  /** The element last pressed in the panel, kept in view when it opens a split. */
  pointerTarget?: () => Element | undefined;
  panelSize: NullableSize;
  contentOffsetTop: Accessor<number>;
  setContentOffsetTop: Setter<number>;
  /**
   * Whether workspace navigation is hidden in a split other than the first.
   * Owned by the split, so it carries across the views the split shows.
   */
  navigationCollapsed?: Signal<boolean>;
  bottomPanel: Accessor<SplitBottomPanelRegistration | undefined>;
  registerBottomPanel: (panel: SplitBottomPanelRegistration) => () => void;
  /**
   * The touch sheet's pinned chrome between its handle and scrolling content,
   * for actions that stay in reach; absent outside a touch popover.
   */
  drawerHeader?: Accessor<HTMLElement | undefined>;
  /**
   * Opens the touch sheet at a fixed 70% height while the calling owner
   * lives, for content that grows to fill it (a composer's body); other
   * content keeps the sheet at its natural height. Absent outside a touch
   * popover.
   */
  fillDrawer?: () => void;
  layoutRefs: {
    headerLeft?: HTMLDivElement;
    headerRight?: HTMLDivElement;
    toolbarLeft?: HTMLDivElement;
    toolbarRight?: HTMLDivElement;
  };
  /**
   * Set while a mobile view's `MobileHeader` owns this pane's header. Other
   * header contributions stand down, so the header shows only what that view
   * composes.
   */
  mobileHeaderOwner: Signal<symbol | undefined>;
  /**
   * How many header contributions declared 32px controls (`SplitHeaderRight`
   * with `size="md"`), so the header's own controls match them.
   */
  headerMdControls?: Signal<number>;
  titleFileMenuRef: Accessor<HTMLDivElement | undefined>;
  setTitleFileMenuRef: Setter<HTMLDivElement | undefined>;
  titleFileMenuTrigger: Accessor<(() => void) | undefined>;
  setTitleFileMenuTrigger: Setter<(() => void) | undefined>;
  titleFileMenuActions: Accessor<SplitFileMenuActionGroups | undefined>;
  setTitleFileMenuActions: Setter<SplitFileMenuActionGroups | undefined>;
  replaceOwnedSlot: ReplaceOwnedSlot;
  headerCollapser: PriorityCollapser;
  toolbarCollapser: PriorityCollapser;
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
