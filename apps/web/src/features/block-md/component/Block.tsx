import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockDataSignal as blockLoaderDataSignal } from '@core/internal/BlockLoader';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
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
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { type ParentProps, Show, Suspense } from 'solid-js';
import type {
  MarkdownDocumentData,
  MarkdownDocumentKind,
} from '../context/markdown-document-context';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import type { MarkdownBlockSpec } from '../definition';
import { OldOverlay } from '../history/OldOverlay';
import {
  loadMarkdownCachedSnapshot,
  saveMarkdownDocument,
} from '../queries/markdown-document-operations';
import { CollabStatus } from './CollabStatus';
import { FindAndReplace } from './FindAndReplace';
import { MarkdownDocument, MarkdownDocumentContent } from './MarkdownDocument';
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
  const isInstructions = () =>
    instructionsMdId.isSuccess && documentId === instructionsMdId.data;
  const markdownState = createMarkdownDocumentState(documentId);
  const { setRevisions, setRewriting } = markdownState.rewrite;
  createMethodRegistration(blockHandleSignal.get, {
    setPatches: ({
      patches,
    }: Parameters<MarkdownBlockSpec['setPatches']>[0]) => {
      setRewriting(false);
      setRevisions(patches);
    },
    setIsRewriting: () => {
      setRewriting(true);
    },
  });
  createMethodRegistration(
    () => (isInstructions() ? blockHandleSignal.get() : undefined),
    {
      goToLocationFromParams: (_params: Record<string, unknown>) => {},
    }
  );
  const notificationSource = useGlobalNotificationSource();

  const rawData = blockLoaderDataSignal.get;
  const data = () => {
    const value = rawData() as
      | (MarkdownDocumentData & { __block?: string })
      | undefined;
    return value?.__block === 'md' ? value : undefined;
  };

  const setLoadError = blockErrorSignal.set;
  const renameDocument = createRenameDssEntityMutation();
  const canComment = useCanComment();
  const canEdit = useCanEdit();
  const isOwner = useIsDocumentOwner();

  return (
    <DocumentBlockContainer>
      <ManagedMarkdownProviders>
        <MarkdownDocument
          documentId={documentId}
          kind={kind}
          state={markdownState}
          data={data()}
          source={blockSourceSignal.get()}
          permissions={{
            canComment: canComment(),
            canEdit: canEdit(),
            isOwner: isOwner(),
          }}
          persistedName={persistedName()}
          fallbackName={fallbackName()}
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
        >
          <OldOverlay />
          <SidePanel.Layout>
            <Show when={!isInstructions()}>
              <ManagedSidePanel />
            </Show>
            <div class="flex flex-col size-full">
              <div class="relative shrink-0">
                <CollabStatus />
                <Suspense>
                  <Show when={isInstructions()} fallback={<ManagedTopBar />}>
                    <InstructionsTopBar />
                  </Show>
                </Suspense>
                <Suspense>
                  <Show when={!isInstructions()}>
                    <div class="absolute right-4 top-1.5 z-action-menu flex justify-end">
                      <FindAndReplace
                        hotkeyScope={blockHotkeyScopeSignal.get()}
                      />
                    </div>
                  </Show>
                </Suspense>
              </div>
              <DocumentDebouncedNotificationReadMarker
                notificationSource={notificationSource}
                documentId={documentId}
              />
              <MarkdownDocumentContent
                isInstructions={isInstructions()}
                hotkeyScope={blockHotkeyScopeSignal.get()}
                autoFocus={canAutofocus && !navigatedFromJK()}
                optimisticSnapshot={props.optimisticSnapshot}
                loadCachedSnapshot={() =>
                  loadMarkdownCachedSnapshot(documentId)
                }
                onDataReady={() => setLoadError(null)}
              />
            </div>
          </SidePanel.Layout>
        </MarkdownDocument>
      </ManagedMarkdownProviders>
    </DocumentBlockContainer>
  );
}
