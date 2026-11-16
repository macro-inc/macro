import { type Accessor, createContext, type JSX, type Setter } from 'solid-js';

export type SidePanelSectionEntry = {
  id: string;
  title: JSX.Element;
  defaultOpen: boolean;
  footer?: boolean;
  /**
   * Render order — lower numbers appear first. Sections without an explicit
   * order render after ordered ones, in their registration order.
   */
  order?: number;
  component: (floating: boolean) => JSX.Element;
};

export type SidePanelContextType = {
  headerActionsMount: Accessor<HTMLDivElement | undefined>;
  setHeaderActionsMount: Setter<HTMLDivElement | undefined>;
  register: (entry: SidePanelSectionEntry) => void;
  unregister: (id: string) => void;
  sections: Accessor<SidePanelSectionEntry[]>;
  /** True when at least one section is registered. */
  hasSections: Accessor<boolean>;
  /**
   * Whether the side panel is open for the current layout mode.
   */
  isOpen: Accessor<boolean>;
  /** Set the open state for the current layout mode. */
  setIsOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle the open state for the current layout mode. */
  toggle: () => void;
  /** New items a section has for the closed panel's toggle badge. */
  unseenCount: Accessor<number>;
  /** A section reports its count here; the latest report wins. */
  reportUnseenCount: (count: Accessor<number> | undefined) => void;
  /** Set which section IDs are expanded in the accordion. */
  setOpenSectionIds: (ids: string[]) => void;
  /** Which section IDs are currently expanded in the accordion. */
  openSectionIds: Accessor<string[]>;
  /**
   * Floating panels use overlays unless wide persistence is opted in.
   * Legacy docked panels also use an overlay on narrow layouts.
   */
  isOverlayMode: Accessor<boolean>;
  setIsOverlayMode: Setter<boolean>;
  /** Whether the panel is rendered as a single floating bubble. */
  isFloating: Accessor<boolean>;
  /** Keep an opted-in floating panel open across visits in wide panes. */
  persistentFloating: Accessor<boolean>;
};

export const SidePanelContext = createContext<SidePanelContextType>();
