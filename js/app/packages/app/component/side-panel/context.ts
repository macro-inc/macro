import { type Accessor, createContext, type JSX, type Setter } from 'solid-js';

export type SidePanelSectionEntry = {
  id: string;
  title: string;
  defaultOpen: boolean;
  component: () => JSX.Element;
};

export type SidePanelContextType = {
  register: (entry: SidePanelSectionEntry) => void;
  unregister: (id: string) => void;
  sections: Accessor<SidePanelSectionEntry[]>;
  /** Whether the side panel is open (user-toggled state) */
  isOpen: Accessor<boolean>;
  /** Set the open state of the side panel */
  setIsOpen: Setter<boolean>;
  /** Toggle the side panel open/closed */
  toggle: () => void;
};

export const SidePanelContext = createContext<SidePanelContextType>();
