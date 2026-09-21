export type CellTextEditorProps = {
  label: string;
  value: string;
  class: string;
  readonly?: boolean;
  autoFocus?: boolean;
  selectAll?: boolean;
  onReady?: (focus: () => void) => void;
  onFocus?: () => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  onSelectionChange?: (start: number, end: number) => void;
};
