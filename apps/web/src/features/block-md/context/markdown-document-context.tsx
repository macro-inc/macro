import type { Source } from '@core/source';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type {
  InitialSync,
  LiveSyncSource,
  TimeoutError,
} from '@macro-inc/collaboration/collab/source';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { ResultAsync } from 'neverthrow';
import type { Accessor, ParentComponent } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { MarkdownDocumentState } from './markdown-document-state';

export type MarkdownDocumentKind = 'document' | 'task' | 'snippet' | 'skill';

export type MarkdownDocumentPermissions = {
  canComment: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export type MarkdownDocumentData = {
  documentMetadata: DocumentMetadata;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
  dssFile?: IDocumentStorageServiceFile;
  syncSource?: LiveSyncSource;
};

export type MarkdownDocumentProps = {
  documentId: string;
  kind: MarkdownDocumentKind;
  state?: MarkdownDocumentState;
  data: MarkdownDocumentData | undefined;
  source: Source | undefined;
  permissions: MarkdownDocumentPermissions;
  persistedName: string | undefined;
  fallbackName: string | undefined;
  saveDocument: (text: string) => Promise<void>;
  renameDocument: (newName: string, oldName: string) => void;
};

export type MarkdownDocumentContextValue = {
  documentId: Accessor<string>;
  kind: Accessor<MarkdownDocumentKind>;
  data: Accessor<MarkdownDocumentData | undefined>;
  source: Accessor<Source | undefined>;
  permissions: {
    canComment: Accessor<boolean>;
    canEdit: Accessor<boolean>;
    isOwner: Accessor<boolean>;
  };
  persistedName: Accessor<string | undefined>;
  fallbackName: Accessor<string | undefined>;
  saveDocument: MarkdownDocumentProps['saveDocument'];
  renameDocument: MarkdownDocumentProps['renameDocument'];
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
