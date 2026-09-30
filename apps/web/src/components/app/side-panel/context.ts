import { type Accessor, createContext, type JSX, type Setter } from 'solid-js';

export type SidePanelSectionEntry = {
  id: string;
  title: JSX.Element;
  defaultOpen: boolean;
  /**
   * Render order — lower numbers appear first. Sections without an explicit
   * order render after ordered ones, in their registration order.
   */
  order?: number;
  component: (floating: boolean) => JSX.Element;
};

export type SidePanelContextType = {
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
  /** Set which section IDs are expanded in the accordion. */
  setOpenSectionIds: (ids: string[]) => void;
  /** Which section IDs are currently expanded in the accordion. */
  openSectionIds: Accessor<string[]>;
  /**
   * Floating panels are always overlays. Legacy docked panels also use
   * an overlay on narrow layouts.
   */
  isOverlayMode: Accessor<boolean>;
  setIsOverlayMode: Setter<boolean>;
  /** Whether the panel is rendered as a single floating bubble. */
  isFloating: Accessor<boolean>;
};

export const SidePanelContext = createContext<SidePanelContextType>();
