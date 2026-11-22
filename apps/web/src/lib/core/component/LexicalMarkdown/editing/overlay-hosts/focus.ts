/** Capabilities used by the shared exterior click target. */
export interface NativeFocusTarget {
  hasSelection(): boolean;
  editable(): boolean;
  focusAtEnd(): void;
}
