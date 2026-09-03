import type { HotkeyToken } from '@core/hotkey/tokens';
import type { NullableSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  type Component,
  createContext,
  type JSX,
  type Setter,
} from 'solid-js';
import type { SplitHandle, SplitManager } from './layoutManager';
import type { ReplaceOwnedSlot } from './utils/createOwnedSlots';
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
  /** Only set when the token's shortcut is executable from the split. */
  hotkeyToken?: HotkeyToken;
  group?: SplitFileMenuActionGroup;
};

/** Menu sections, in render order. */
export type SplitFileMenuActionGroups = {
  /** Actions specific to the block's entity type, e.g. email's Mark done. */
  entity: SplitFileMenuAction[];
  /** Email sender actions. */
  sender: SplitFileMenuAction[];
  /** Share, Copy Link, Copy ID, and friends. */
  sharing: SplitFileMenuAction[];
  /** Macro platform features: Favorite, Mute, Remind me, Add tag. */
  macro: SplitFileMenuAction[];
  /** Non-destructive operations on the file itself: Duplicate, Rename, Move, Download. */
  file: SplitFileMenuAction[];
  /** Destructive actions, always last. */
  delete: SplitFileMenuAction[];
};

/**
 * Menu section an action renders in. Untagged tools and ops default to the
 * entity section — a block's own actions are entity-specific unless said
 * otherwise; a `group` tag moves an action to another section (Share and
 * Download live with their injected siblings, email keeps sender actions
 * right below its entity actions).
 */
export type SplitFileMenuActionGroup = keyof SplitFileMenuActionGroups;

export type SplitFileMenuActionSection = {
  key: keyof SplitFileMenuActionGroups;
  actions: SplitFileMenuAction[];
};

export function getSplitFileMenuActionSections(
  groups: SplitFileMenuActionGroups
): SplitFileMenuActionSection[] {
  const sections: SplitFileMenuActionSection[] = [
    { key: 'entity', actions: groups.entity },
    { key: 'sender', actions: groups.sender },
    { key: 'sharing', actions: groups.sharing },
    { key: 'macro', actions: groups.macro },
    { key: 'file', actions: groups.file },
    { key: 'delete', actions: groups.delete },
  ];

  return sections.filter((section) => section.actions.length > 0);
}

export type SplitPanelContextType = {
  handle: SplitHandle;
  splitHotkeyScope: string;
  /** Whether mounted block content is rendered in a passive inline preview. */
  isInlinePreview?: boolean;
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
  replaceOwnedSlot: ReplaceOwnedSlot;
  headerCollapser: PriorityCollapser;
  toolbarCollapser: PriorityCollapser;
};

export const SplitPanelContext = createContext<SplitPanelContextType>();
