import { type Accessor, createContext, type JSX } from 'solid-js';

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
};

export const SidePanelContext = createContext<SidePanelContextType>();
