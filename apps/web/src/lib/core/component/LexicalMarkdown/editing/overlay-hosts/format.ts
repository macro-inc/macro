import type { TextFormatType } from 'lexical';
import type { Accessor } from 'solid-js';
import type { NodeTransformType } from '../../plugins/node-transform/nodeTransformPlugin';
import type { SelectionData } from '../../plugins/selection-data/selectionDataPlugin';

export type FormattingSelection = Readonly<
  Pick<
    SelectionData,
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | 'code'
    | 'superscript'
    | 'subscript'
    | 'highlight'
    | 'hasLinks'
  >
> & { readonly elementsInRange: ReadonlySet<string> };

/** Formatting UI capabilities without an editor or model selection facade. */
export interface FormatMenuHost {
  readonly selection: Accessor<FormattingSelection | undefined>;
  isInteractable(): boolean;
  root(): HTMLElement | null;
  focus(): void;
  formatText(format: TextFormatType): void;
  formatBlock(format: NodeTransformType): void;
  requestLink(): void;
  unlink(): void;
  registerPopup(callbacks: {
    visible(value: boolean): boolean;
    selection(value: Selection | undefined): void;
  }): void;
  registerListeners(callbacks: {
    focusOut(relatedTarget: EventTarget | null): void;
    transform(): boolean;
    escape(): boolean;
  }): void;
}
