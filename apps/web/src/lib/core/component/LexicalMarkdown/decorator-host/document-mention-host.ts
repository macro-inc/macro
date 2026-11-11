/** Only editor operations used by the actual document mention UI. Navigation and preview providers stay shared. */
export interface DocumentMentionHost {
  isSelected(key: string): boolean;
  isEditable(): boolean;
  isInteractable(): boolean;
  canEmbed(): boolean;
  readonly skipPreviewFetch: boolean;
  registerEditableListener(
    listener: (editable: boolean) => void
  ): (() => void) | undefined;
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): (() => void) | undefined;
  updateDocumentNames(names: Record<string, string>): void;
  remove(key: string): void;
  convertToText(key: string, text: string): void;
  convertToCard(key: string): void;
  setCollapsed(key: string, collapsed: boolean): void;
}
