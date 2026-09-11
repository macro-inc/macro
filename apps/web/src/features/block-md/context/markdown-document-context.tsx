import type { Source } from '@core/source';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import type {
  InitialSync,
  LiveSyncSource,
  TimeoutError,
} from '@macro-inc/collaboration/collab/source';
import type { NotificationSource } from '@notifications';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { ResultAsync } from 'neverthrow';
import type { Accessor, Component, JSX, ParentComponent } from 'solid-js';
import { createContext, useContext } from 'solid-js';
import type { MarkdownRewriteOutput } from '../signal/rewriteSignal';
import type { MarkdownDocumentState } from './markdown-document-state';

export type MarkdownDocumentKind = 'document' | 'task' | 'snippet' | 'skill';

export type MarkdownDocumentPermissions = {
  canComment: Accessor<boolean>;
  canEdit: Accessor<boolean>;
  isOwner: Accessor<boolean>;
};

export type MarkdownDocumentData = {
  documentMetadata: DocumentMetadata;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
  dssFile?: IDocumentStorageServiceFile;
  syncSource?: LiveSyncSource;
};

export type MarkdownDocumentMethods = Partial<{
  setPatches: (args: {
    patches: MarkdownRewriteOutput['diffs'];
  }) => Promise<void> | void;
  setIsRewriting: () => Promise<void> | void;
  goToLocationFromParams: (params: Record<string, unknown>) => void;
}>;

export type MarkdownDocumentProps = {
  documentId: string;
  kind: MarkdownDocumentKind;
  data: Accessor<MarkdownDocumentData | undefined>;
  source: Accessor<Source | undefined>;
  permissions: MarkdownDocumentPermissions;
  persistedName: Accessor<string | undefined>;
  fallbackName: Accessor<string | undefined>;
  isInstructions?: Accessor<boolean>;
  hostElement?: Accessor<HTMLElement | undefined>;
  hotkeyScope?: Accessor<string | undefined>;
  autoFocus?: boolean;
  navigatedFromJK?: Accessor<boolean>;
  renderCollaborationStatus?: () => JSX.Element;
  notificationSource?: NotificationSource;
  optimisticSnapshot?: Uint8Array<ArrayBufferLike>;
  loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
  onDataReady?: () => void;
  registerMethods?: (methods: MarkdownDocumentMethods) => void;
  saveDocument: (text: string) => Promise<void>;
  renameDocument: (newName: string, oldName: string) => void;
  topBar?: Component;
  instructionsTopBar?: Component;
  sidePanel?: Component;
  historyOverlay?: Component;
};

export type MarkdownDocumentContextValue = MarkdownDocumentProps & {
  state: MarkdownDocumentState;
  element: Accessor<HTMLElement | undefined>;
  isInstructions: Accessor<boolean>;
  hotkeyScope: Accessor<string | undefined>;
  autoFocus: boolean;
  navigatedFromJK: Accessor<boolean>;
  loadCachedSnapshot: () => Promise<Uint8Array | undefined>;
  onDataReady: () => void;
  registerMethods: (methods: MarkdownDocumentMethods) => void;
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
