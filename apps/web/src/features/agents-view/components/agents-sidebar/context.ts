import { createContext, useContext } from 'solid-js';
import type { AgentsPage } from '../../core/pages';

export type AgentsSidebarNavigation = {
  activePage?: AgentsPage;
  onOpenPage: (page: AgentsPage) => void;
};
export const AgentsSidebarContext = createContext<AgentsSidebarNavigation>();
export function useAgentsSidebar() {
  const context = useContext(AgentsSidebarContext);
  if (!context) throw new Error('AgentsSidebarRoot is required');
  return context;
}
