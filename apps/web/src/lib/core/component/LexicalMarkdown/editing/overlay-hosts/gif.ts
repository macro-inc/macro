import type { Accessor } from 'solid-js';
import type { Gif } from '../../plugins/gif';

/** Targets and in-flight insertion snapshots belong to their real editor host. */
export interface GifMenuHost<Target, Insertion> {
  root(): HTMLElement | null;
  focus(): void;
  isEditable(): boolean;
  captureTarget(): Target;
  prepareInsertion(
    target: Target | null,
    canEdit: Accessor<boolean>
  ): Insertion | undefined;
  subscribeChanges(insertion: Insertion, onDirty: () => void): () => void;
  isCurrent(insertion: Insertion): boolean;
  /** Actual synchronous insertion result; queued dispatch is not completion. */
  commit(
    insertion: Insertion,
    gif: Gif,
    staticFileId: string,
    onInserted: () => void
  ): boolean;
  /** The host's plugin manager owns picker registration and cleanup. */
  registerPicker(canEdit: Accessor<boolean>, onOpen: () => void): void;
  /** Register under the panel's current owner, including upload cancellation. */
  registerPanel(panel: HTMLElement, cancelUpload: () => void): void;
}
