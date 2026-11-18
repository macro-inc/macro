import type { PaneId } from '@app/lib/split-router';
import type { SplitId } from './layoutManager';

// Apart from the layout manager, so code that needs only the ids does not
// load the manager and everything it imports.

/** A split is its router pane; the ids are the same string. */
export const paneOf = (id: SplitId) => id as string as PaneId;
export const splitOf = (pane: PaneId) => pane as string as SplitId;
