import type { Action } from './types';

/** Source order is retained when an additional action replaces an existing ID. */
export function mergeActions(
  actions: readonly Action[],
  additional: readonly Action[] = []
): Action[] {
  const merged = [...actions];
  for (const override of additional) {
    const index = merged.findIndex((action) => action.id === override.id);
    if (index >= 0) merged[index] = override;
    else merged.push(override);
  }
  return merged;
}

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
    if (
      (action.id === 'database-query' || action.id === 'database') &&
      !options.databasesEnabled
    )
      return false;
    if (options.ignoreActionIds?.includes(action.id)) return false;
    const { dependencies } = action;
    if (dependencies === undefined || dependencies.length === 0) return true;
    return options.hasNodes(dependencies);
  });
}
