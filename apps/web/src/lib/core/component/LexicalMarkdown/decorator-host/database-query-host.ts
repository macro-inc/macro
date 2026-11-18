import type { DatabaseQueryData } from '@macro-inc/lexical-core/nodes/databaseQueryData';
import type { DecoratorSelectionHost } from './selection-host';

/** DatabaseQuery's editor dependencies: editability, block selection and answer edits. */
export interface DatabaseQueryHost extends DecoratorSelectionHost {
  isEditable(): boolean;
  registerEditableListener(listener: (editable: boolean) => void): () => void;
  isInteractable(): boolean;
  previewFetchEnabled(): boolean;
  selectBlock(key: string): void;
  save(key: string, data: DatabaseQueryData): void;
  discard(key: string): void;
}
export interface DatabaseQueryHostProp {
  readonly host?: DatabaseQueryHost;
}
