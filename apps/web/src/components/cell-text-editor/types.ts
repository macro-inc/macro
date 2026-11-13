export type CellTextEditorProps = {
  label: string;
  value: string;
  class: string;
  readonly?: boolean;
  autoFocus?: boolean;
  selectAll?: boolean;
  /** Shift+Enter starts a new line, as Alt+Enter always does. */
  lineBreakOnShiftEnter?: boolean;
  onReady?: (focus: () => void) => void;
  onFocus?: () => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  onSelectionChange?: (start: number, end: number) => void;
};
