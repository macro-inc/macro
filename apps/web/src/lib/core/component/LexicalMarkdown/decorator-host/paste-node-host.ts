import type { DecoratorSelectionHost } from './selection-host';

/** PasteNode's editor dependencies: selection and the convert/delete actions. */
export interface PasteNodeHost extends DecoratorSelectionHost {
  isEditable(): boolean;
  selectNode(key: string): void;
  convertToText(key: string): void;
  deleteNode(key: string): void;
}
export interface PasteNodeHostProp {
  readonly host?: PasteNodeHost;
}
