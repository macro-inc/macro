import type { CellTextEditorProps } from '@app/components/cell-text-editor/types';
import type { JSX } from 'solid-js';

export type { CellTextEditorProps } from '@app/components/cell-text-editor/types';
export type SpreadsheetMentions = {
  renderText: (value: string) => JSX.Element;
  renderEditor: (props: CellTextEditorProps) => JSX.Element;
};
