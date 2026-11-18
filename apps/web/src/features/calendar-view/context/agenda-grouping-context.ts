import { createContext, useContext } from 'solid-js';
import type { AgendaGrouping } from '../primitives/create-agenda-grouping';

export const AgendaGroupingContext = createContext<AgendaGrouping>();
export function useAgendaGrouping() {
  const context = useContext(AgendaGroupingContext);
  if (!context) throw new Error('Agenda windows require the grouping owner');
  return context;
}
