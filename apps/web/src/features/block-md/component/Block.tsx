import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockDataSignal as blockLoaderDataSignal } from '@core/internal/BlockLoader';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import {
  blockErrorSignal,
  blockHandleSignal,
  blockSourceSignal,
} from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createRenameDssEntityMutation } from '@entity';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { type ParentProps, Show } from 'solid-js';
import type {
  MarkdownDocumentData,
  MarkdownDocumentKind,
} from '../context/markdown-document-context';
import { OldOverlay } from '../history/OldOverlay';
import {
  loadMarkdownCachedSnapshot,
  saveMarkdownDocument,
} from '../queries/markdown-document-operations';
import { CollabStatus } from './CollabStatus';
import { MarkdownDocument } from './MarkdownDocument';
import { useMarkdownName } from './MarkdownNameProvider';
import { ModalsProvider } from './ModalsProvider';
import { MarkdownSidePanelSections } from './sidepanel/MarkdownSidePanelSections';
import { InstructionsTopBar, TopBar } from './TopBar';

export interface BlockMarkdownProps {
  /**
   * A Loro snapshot to load while waiting for a remote snapshot.
   */
  optimisticSnapshot?: Uint8Array<ArrayBufferLike>;
}

function ManagedTopBar() {
  const { displayName } = useMarkdownName();
  return <TopBar name={displayName} />;
}

function ManagedSidePanel() {
  const canEdit = useCanEdit();
  const { displayName } = useMarkdownName();
  return (
    <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
      <MarkdownSidePanelSections
        canEdit={canEdit()}
        documentName={displayName() ?? ''}
      />
    </Show>
  );
}

function ManagedMarkdownProviders(props: ParentProps) {
  return <ModalsProvider>{props.children}</ModalsProvider>;
}

export default function MarkdownBlockAdapter(props: BlockMarkdownProps) {
  useBlockEntityCommands();

  const documentId = useBlockId();
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const currentBlockName = useBlockAliasedName();
  const kind: MarkdownDocumentKind =
    currentBlockName === 'task' ||
    currentBlockName === 'snippet' ||
    currentBlockName === 'skill'
      ? currentBlockName
      : 'document';
  const persistedName = useBlockDocumentName('');
  const fallbackName = useBlockDocumentName();
  const instructionsMdId = useInstructionsMdIdQuery();

  const rawData = blockLoaderDataSignal.get;
  const data = () => {
    const value = rawData() as
      | (MarkdownDocumentData & { __block?: string })
      | undefined;
    return value?.__block === 'md' ? value : undefined;
  };

  const blockHandle = blockHandleSignal.get;
  const setLoadError = blockErrorSignal.set;
  const renameDocument = createRenameDssEntityMutation();
  const permissions = {
    canComment: useCanComment(),
    canEdit: useCanEdit(),
    isOwner: useIsDocumentOwner(),
  };

  return (
    <DocumentBlockContainer>
      <ManagedMarkdownProviders>
        <MarkdownDocument
          documentId={documentId}
          kind={kind}
          data={data}
          source={blockSourceSignal.get}
          permissions={permissions}
          persistedName={persistedName}
          fallbackName={fallbackName}
          isInstructions={() =>
            instructionsMdId.isSuccess && documentId === instructionsMdId.data
          }
          hostElement={blockElementSignal.get}
          hotkeyScope={blockHotkeyScopeSignal.get}
          autoFocus={canAutofocus}
          navigatedFromJK={navigatedFromJK}
          renderCollaborationStatus={() => <CollabStatus />}
          notificationSource={useGlobalNotificationSource()}
          optimisticSnapshot={props.optimisticSnapshot}
          loadCachedSnapshot={() => loadMarkdownCachedSnapshot(documentId)}
          onDataReady={() => setLoadError(null)}
          registerMethods={(methods) =>
            createMethodRegistration(blockHandle, methods)
          }
          saveDocument={(text) => saveMarkdownDocument(documentId, text)}
          renameDocument={(newName, oldName) => {
            renameDocument.mutate({
              entity: {
                type: 'document',
                name: oldName,
                id: documentId,
              },
              newName,
            });
          }}
          topBar={ManagedTopBar}
          instructionsTopBar={InstructionsTopBar}
          sidePanel={ManagedSidePanel}
          historyOverlay={OldOverlay}
        />
      </ManagedMarkdownProviders>
    </DocumentBlockContainer>
  );
}
