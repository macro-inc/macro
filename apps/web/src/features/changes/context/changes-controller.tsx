/**
 * Transport for the built controller: the entry point constructs it, views
 * read it. Missing provider setup fails clearly instead of reaching real
 * services.
 */

import { createContext, useContext } from 'solid-js';
import type { ChangesController } from '../primitives/create-changes';

const Context = createContext<ChangesController>();

export const ChangesControllerProvider = Context.Provider;

export function useChanges(): ChangesController {
  const controller = useContext(Context);
  if (!controller) {
    throw new Error('ChangesControllerProvider is required');
  }
  return controller;
}

/** The controller when a host mounted one; undefined outside the pane. */
export function useOptionalChanges(): ChangesController | undefined {
  return useContext(Context);
}
