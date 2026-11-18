import type { Action, ActionContext } from '../../plugins/actions/types';

/** Catalog metadata crosses this seam; editor and node instances do not. */
export interface ActionMenuHost {
  root(): HTMLElement | null;
  subscribeRoot(listener: () => void): () => void;
  hasDependencies(dependencies: NonNullable<Action['dependencies']>): boolean;
  closeSearch(): void;
  select(
    action: Action | undefined,
    origin: 'pointer' | 'keyboard',
    context?: ActionContext
  ): void;
}
