import { type Accessor, createContext, type JSX } from 'solid-js';

export type SidePanelSectionEntry = {
  id: string;
  title: JSX.Element;
  defaultOpen: boolean;
  /**
   * Render order — lower numbers appear first. Sections without an explicit
   * order render after ordered ones, in their registration order.
   */
  order?: number;
  component: () => JSX.Element;
};

export type SidePanelContextType = {
  register: (entry: SidePanelSectionEntry) => void;
  unregister: (id: string) => void;
  sections: Accessor<SidePanelSectionEntry[]>;
  /** True when at least one section is registered. */
  hasSections: Accessor<boolean>;
  /**
   * Whether the side panel is open for the current layout mode.
   * In wide mode this controls the split; in narrow mode it controls the overlay.
   */
  isOpen: Accessor<boolean>;
  /** Set the open state for the current layout mode. */
  setIsOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle the open state for the current layout mode. */
  toggle: () => void;
  /**
   * True when the layout is mobile or narrower than the split threshold.
   * In this mode the side panel renders as a full-screen overlay rather than
   * a side-by-side split.
   */
  isNarrow: Accessor<boolean>;
};

export const SidePanelContext = createContext<SidePanelContextType>();
