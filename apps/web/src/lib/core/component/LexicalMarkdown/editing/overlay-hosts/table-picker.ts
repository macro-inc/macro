import type { Accessor } from 'solid-js';

/** Model capabilities used by the shared table size picker. */
export interface TablePickerHost {
  root(): HTMLElement | null;
  focus(): void;
  insert(rows: number, columns: number): void;
  /** Registration belongs to the host's plugin installation lifetime. */
  registerPicker(canEdit: Accessor<boolean>, onCreate: () => void): void;
}
