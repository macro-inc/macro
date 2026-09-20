/**
 * Transport for the built controller: the entry point constructs it, views
 * read it. Missing provider setup fails clearly instead of reaching real
 * services.
 */

import { createContext, useContext } from 'solid-js';
import type { AgentChangesController } from '../primitives/create-agent-changes';

const Context = createContext<AgentChangesController>();

export const AgentChangesControllerProvider = Context.Provider;

export function useAgentChanges(): AgentChangesController {
  const controller = useContext(Context);
  if (!controller) {
    throw new Error('AgentChangesControllerProvider is required');
  }
  return controller;
}

/** The controller when a host mounted one; undefined outside the pane. */
export function useOptionalAgentChanges(): AgentChangesController | undefined {
  return useContext(Context);
}
