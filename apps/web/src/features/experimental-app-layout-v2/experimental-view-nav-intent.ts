import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { LibrarySection } from './experimental-view-navigation';

export type ExperimentalViewNavHost = 'mail' | 'tasks' | 'documents';

export type ExperimentalViewNavIntent =
  | { host: 'mail'; tab: string }
  | { host: 'tasks'; tab: string }
  | { host: 'documents'; section: LibrarySection }
  | { host: 'documents'; projectId: string }
  | { host: 'documents'; favorites: Favorite[] };

let pendingViewNavIntent: ExperimentalViewNavIntent | undefined;

/** Queue a list-view destination to apply once that view mounts. */
export function setExperimentalViewNavIntent(
  intent: ExperimentalViewNavIntent
) {
  pendingViewNavIntent = intent;
}

/** Take a pending destination for `host`, if one is waiting. */
export function takeExperimentalViewNavIntent<
  Host extends ExperimentalViewNavHost,
>(host: Host): Extract<ExperimentalViewNavIntent, { host: Host }> | undefined {
  if (pendingViewNavIntent?.host !== host) return undefined;
  const intent = pendingViewNavIntent as Extract<
    ExperimentalViewNavIntent,
    { host: Host }
  >;
  pendingViewNavIntent = undefined;
  return intent;
}
