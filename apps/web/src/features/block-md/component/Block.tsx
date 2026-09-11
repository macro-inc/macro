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
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { type ParentProps, Show, Suspense } from 'solid-js';
import type {
  MarkdownDocumentKind,
  MarkdownDocumentMode,
} from '../context/markdown-document-context';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import type { MarkdownBlockSpec, MarkdownData } from '../definition';
import { OldOverlay } from '../history/OldOverlay';
import { loadMarkdownCachedSnapshot } from '../queries/markdown-document-operations';
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
    goToLocationFromParams: markdownState.params.navigate,
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
  const notificationSource = useGlobalNotificationSource();

  const rawData = blockLoaderDataSignal.get;
  const data = () => {
    const value = rawData() as
      | (MarkdownData & { __block?: string })
      | undefined;
    return value?.__block === 'md' ? value : undefined;
  };
  const mode = (): MarkdownDocumentMode | undefined => {
    const source = blockSourceSignal.get();
    if (source?.type === 'sync-service') return 'sync';
    if (source?.type === 'dss') return 'dss';
  };

  const setLoadError = blockErrorSignal.set;
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
          isReady={data() !== undefined}
          mode={mode()}
          dssFile={data()?.dssFile}
          syncSource={data()?.syncSource}
          permissions={{
            canComment: canComment(),
            canEdit: canEdit(),
            isOwner: isOwner(),
          }}
          persistedName={persistedName()}
          fallbackName={fallbackName()}
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
                doInitialSync={data()?.doInitialSync}
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
