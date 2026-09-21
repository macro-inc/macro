import type { JSX } from 'solid-js';
export type CellTextEditorProps = {
  label: string;
  value: string;
  class: string;
  readonly?: boolean;
  autoFocus?: boolean;
  onFocus?: () => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  onSelectionChange?: (start: number, end: number) => void;
};
export type SpreadsheetMentions = {
  renderText: (value: string) => JSX.Element;
  renderEditor: (props: CellTextEditorProps) => JSX.Element;
};
