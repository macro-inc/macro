declare module '@upstream/LexicalEditorState' {
  import type { EditorState } from 'lexical';
  export function createEmptyEditorState(): EditorState;
}
declare module '@upstream/LexicalSelection' {
  import type {
    BaseSelection,
    LexicalEditor,
    PointType,
    RangeSelection as RangeSelectionType,
  } from 'lexical';
  export const RangeSelection: new (
    anchor: PointType,
    focus: PointType,
    format: number,
    style: string
  ) => RangeSelectionType;
  export function $internalCreateRangeSelection(
    lastSelection: BaseSelection | null,
    domSelection: Selection | null,
    editor: LexicalEditor,
    event: UIEvent | Event | null
  ): RangeSelectionType | null;
}
declare module '@upstream/LexicalUpdates' {
  import type {
    EditorState,
    EditorUpdateOptions,
    LexicalEditor,
  } from 'lexical';
  export function getActiveEditor(): LexicalEditor;
  export function getActiveEditorState(): EditorState;
  export function isCurrentlyReadOnlyMode(): boolean;
  export function updateEditorSync(
    editor: LexicalEditor,
    body: () => void,
    options?: EditorUpdateOptions
  ): void;
}
declare module '@upstream/LexicalUtils' {
  export function $getCompositionKey(): string | null;
  export function resetRandomKey(): void;
}
