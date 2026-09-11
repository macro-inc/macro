import type { Accessor, ParentComponent } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { MarkdownDocumentKind, MarkdownDocumentSource } from '../types';
import type { MarkdownDocumentState } from './markdown-document-state';

export type MarkdownDocumentContextValue = {
  documentId: Accessor<string>;
  kind: Accessor<MarkdownDocumentKind>;
  documentSource: Accessor<MarkdownDocumentSource>;
  permissions: {
    canComment: Accessor<boolean>;
    canEdit: Accessor<boolean>;
    isOwner: Accessor<boolean>;
  };
  persistedName: Accessor<string | undefined>;
  fallbackName: Accessor<string | undefined>;
  state: MarkdownDocumentState;
  element: Accessor<HTMLElement | undefined>;
};

const MarkdownDocumentContext = createContext<MarkdownDocumentContextValue>();

export const MarkdownDocumentProvider: ParentComponent<{
  context: MarkdownDocumentContextValue;
}> = (props) => (
  <MarkdownDocumentContext.Provider value={props.context}>
    {props.children}
  </MarkdownDocumentContext.Provider>
);

export function useMarkdownDocument(): MarkdownDocumentContextValue {
  const context = useContext(MarkdownDocumentContext);
  if (!context) {
    throw new Error('MarkdownDocumentProvider is required');
  }
  return context;
}
