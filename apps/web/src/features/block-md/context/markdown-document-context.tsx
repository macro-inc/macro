import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import type { Accessor, ParentComponent } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { MarkdownDocumentState } from './markdown-document-state';

export type MarkdownDocumentKind = 'document' | 'task' | 'snippet' | 'skill';
export type MarkdownDocumentMode = 'dss' | 'sync';

export type MarkdownDocumentPermissions = {
  canComment: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export type MarkdownDocumentProps = {
  documentId: string;
  kind: MarkdownDocumentKind;
  state?: MarkdownDocumentState;
  isReady: boolean;
  mode: MarkdownDocumentMode | undefined;
  dssFile: IDocumentStorageServiceFile | undefined;
  syncSource: LiveSyncSource | undefined;
  permissions: MarkdownDocumentPermissions;
  persistedName: string | undefined;
  fallbackName: string | undefined;
};

export type MarkdownDocumentContextValue = {
  documentId: Accessor<string>;
  kind: Accessor<MarkdownDocumentKind>;
  isReady: Accessor<boolean>;
  mode: Accessor<MarkdownDocumentMode | undefined>;
  dssFile: Accessor<IDocumentStorageServiceFile | undefined>;
  syncSource: Accessor<LiveSyncSource | undefined>;
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
