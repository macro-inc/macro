import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type {
  ViewSelection,
  ViewSelectionInfo,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { Accessor, Component } from 'solid-js';
import type { NativeBlockKind } from '../plugins/node-transform/native';

export type NativeMarkdownMenu = 'actions' | 'mentions' | 'snippets';
export type NativeTextFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'code'
  | 'subscript'
  | 'superscript'
  | 'highlight';

/** Local selection capture; adapters validate its generation and document revision. */
export interface NativeSelectionBookmark {
  readonly generation: number;
  readonly revision: number;
  readonly selection: ViewSelection;
  readonly text: string;
}
/** Read-only DOM anchors for shared comment-margin geometry, never editor writes. */
export interface NativeCommentAnchor {
  readonly markId: string;
  readonly elements: readonly HTMLElement[];
}

/** Native UI renders under the host's app/comment providers without a Lexical context. */
export interface NativeMarkdownEditingPort {
  readonly view: EditorView;
  readonly renderers: {
    readonly Menus: Component;
    readonly Toolbar: Component;
    readonly Comments: Component;
  };
  readonly menus: {
    readonly isOpen: Accessor<boolean>;
    open(menu: NativeMarkdownMenu): void;
    close(): void;
  };
  readonly toolbar: {
    readonly selection: Accessor<ViewSelectionInfo>;
    captureSelection(): NativeSelectionBookmark | null;
    restoreSelection(bookmark: NativeSelectionBookmark): boolean;
    setBlock(kind: NativeBlockKind): void;
    formatText(format: NativeTextFormat): void;
    insertLink(url: string, label: string): void;
    insertCode(language: string, text: string): void;
    insertTable(rows: number, columns: number): void;
    undo(): void;
    redo(): void;
  };
  readonly comments: {
    captureSelection(): NativeSelectionBookmark | null;
    publish(
      markId: string,
      bookmark: NativeSelectionBookmark
    ): Promise<boolean>;
    remove(markId: string): Promise<boolean>;
    select(markId: string | undefined): void;
    readonly anchors: Accessor<readonly NativeCommentAnchor[]>;
  };
  readonly focus: {
    atStart(): void;
    prependParagraph(): void;
    atEnd(): void;
    appendEmptyParagraph(): void;
  };
  dispose(): void;
}
