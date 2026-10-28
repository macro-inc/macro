import { createContext, useContext } from 'solid-js';

export const SidebarVisibilityContext = createContext<() => boolean>(
  () => false
);
export const isSidebarVisible = () => useContext(SidebarVisibilityContext)();
