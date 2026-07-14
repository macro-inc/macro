import { createContext, useContext } from 'solid-js';

export const SidebarVisibilityContext = createContext<() => boolean>(
  () => false
);
export const isSidebarVisible = () => useContext(SidebarVisibilityContext)();

export type SidebarCollapseContextValue = {
  isCollapsed: () => boolean;
  expand: () => void;
};

export const SidebarCollapseContext =
  createContext<SidebarCollapseContextValue>({
    isCollapsed: () => false,
    expand: () => {},
  });

export const useSidebarCollapse = () => useContext(SidebarCollapseContext);
