/** Model capabilities used by the existing snippet catalog and controller. */
export interface SnippetMenuHost {
  root(): HTMLElement | null;
  closeSearch(): void;
  insertSnippet(documentId: string, sourceDocumentId?: string): void;
}
