/** Only the editor operations used by the shared Snapshot component. */
export interface SnapshotHost {
  isSelected(key: string): boolean;
  isEditable(): boolean;
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): (() => void) | undefined;
  remove(key: string): void;
}
