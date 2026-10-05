import type { Action } from './types';

/** The slash-menu entries this editor offers, in their listed order. */
export function availableActions(
  actions: readonly Action[],
  options: {
    databasesEnabled: boolean;
    ignoreActionIds?: readonly string[];
    hasNodes: (dependencies: NonNullable<Action['dependencies']>) => boolean;
  }
): Action[] {
  return actions.filter((action) => {
    if (action.id === 'database-query' && !options.databasesEnabled)
      return false;
    if (options.ignoreActionIds?.includes(action.id)) return false;
    const { dependencies } = action;
    if (dependencies === undefined || dependencies.length === 0) return true;
    return options.hasNodes(dependencies);
  });
}
