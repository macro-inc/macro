import type {
  FormatMenuHost,
  FormattingSelection,
} from '@core/component/LexicalMarkdown/editing/overlay-hosts/format';
import type { NodeTransformType } from '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin';
import type { TextFormatType } from 'lexical';
import type { Accessor } from 'solid-js';

export type { FormattingSelection } from '@core/component/LexicalMarkdown/editing/overlay-hosts/format';

/** An installed capability, not inferred from the presence of table nodes. */
export interface FormattingTableHost {
  readonly canMerge: Accessor<boolean>;
  readonly canSplit: Accessor<boolean>;
  merge(): void;
  split(): void;
  insert(rows: number, columns: number): void;
  readonly canConvertList: Accessor<boolean>;
  convertList(after: (handled: boolean) => void): void;
}

/** The actual document body supplies these operations and owns their lifetime. */
export interface DocumentFormattingHost {
  readonly selection: Accessor<FormattingSelection | undefined>;
  readonly focused: Accessor<boolean>;
  readonly editable: Accessor<boolean>;
  readonly interactable: Accessor<boolean>;
  readonly root: Accessor<HTMLElement | null>;
  readonly tables?: FormattingTableHost;
  focus(): void;
  formatText(format: TextFormatType): void;
  formatBlock(format: NodeTransformType): void;
  requestLink(): void;
  unlink(): void;
  insertEquation?(): void;
  insertDivider?(): void;
}

/** Popup presentation from the current native view; rectangle() performs only DOM reads. */
export interface BodyFormattingPopupHost {
  rectangle(): DOMRect | undefined;
  /** The published model selection's plain text; '' for a caret or a
   *  zero-text range (Source MarkdownPopup `selection()?.text`). */
  selectionText: Accessor<string>;
  /** Source savedLinkSelection: capture the current selection; `insert(input)`
   *  later adds a link over it, labelled with the selection text at submit, or
   *  with the raw input when no selection exists. */
  captureLink(): { insert(url: string): void };
  registerPopup: FormatMenuHost['registerPopup'];
  registerListeners: FormatMenuHost['registerListeners'];
}
