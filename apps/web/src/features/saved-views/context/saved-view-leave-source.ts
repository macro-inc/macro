import type { Accessor } from 'solid-js';

/** A consumer's active, unsaved definition; confirmed view edits are not guarded. */
export type SavedViewLeaveSource = {
  identity: Accessor<string | undefined>;
  viewerId: Accessor<string | undefined>;
  dirty: Accessor<boolean>;
  allowNavigation?: () => boolean;
  busy: Accessor<boolean>;
  save: () => Promise<void>;
  discard: () => void;
  register: (run: (action: () => void) => void) => () => void;
};
