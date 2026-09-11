import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
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
import { Show, Suspense } from 'solid-js';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import type { MarkdownBlockSpec, MarkdownData } from '../definition';
import { OldOverlay } from '../history/OldOverlay';
import { loadMarkdownCachedSnapshot } from '../queries/markdown-document-operations';
import type { MarkdownDocumentKind, MarkdownDocumentSource } from '../types';
import { FindAndReplace } from './FindAndReplace';
import { MarkdownDocument, MarkdownDocumentContent } from './MarkdownDocument';
import { useMarkdownName } from './MarkdownNameProvider';
import { ModalsProvider } from './ModalsProvider';
import { MarkdownSidePanelSections } from './sidepanel/MarkdownSidePanelSections';
import { InstructionsTopBar, TopBar } from './TopBar';
import { useTaskBranchNameHotkey } from './useTaskBranchNameHotkey';

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
  useTaskBranchNameHotkey({
    documentId: () => documentId,
    kind: () => kind,
    scopeId: blockHotkeyScopeSignal.get,
  });
  const persistedName = useBlockDocumentName('');
  const fallbackName = useBlockDocumentName();
  const instructionsMdId = useInstructionsMdIdQuery();
  const isInstructions = () =>
    instructionsMdId.isSuccess && documentId === instructionsMdId.data;
  const markdownState = createMarkdownDocumentState();
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
  const documentSource = (): MarkdownDocumentSource => {
    const loaded = data();
    if (!loaded) return { type: 'loading' };

    const source = blockSourceSignal.get();
    if (source?.type === 'sync-service' && loaded.syncSource) {
      return { type: 'sync', source: loaded.syncSource };
    }
    if (source?.type === 'dss' && loaded.dssFile) {
      return { type: 'dss', file: loaded.dssFile };
    }

    return { type: 'loading' };
  };
  const collaborationStatus = () => {
    const source = documentSource();
    return source.type === 'sync' ? source.source.status() : undefined;
  };

  const setLoadError = blockErrorSignal.set;
  const canComment = useCanComment();
  const canEdit = useCanEdit();
  const isOwner = useIsDocumentOwner();

  return (
    <DocumentBlockContainer>
      <MarkdownDocument
        documentId={documentId}
        kind={kind}
        state={markdownState}
        documentSource={documentSource()}
        permissions={{
          canComment: canComment(),
          canEdit: canEdit(),
          isOwner: isOwner(),
        }}
        persistedName={persistedName()}
        fallbackName={fallbackName()}
      >
        <ModalsProvider>
          <OldOverlay />
          <SidePanel.Layout>
            <Show when={ENABLE_MARKDOWN_SIDE_PANEL && !isInstructions()}>
              <MarkdownSidePanelSections />
            </Show>
            <div class="flex flex-col size-full">
              <div class="relative shrink-0">
                <SplitHeaderRight>
                  <Show
                    when={isCollaborationStatusVisible(collaborationStatus())}
                  >
                    <HeaderIsland class="-order-1">
                      <CollaborationStatusIndicator
                        status={collaborationStatus()}
                      />
                    </HeaderIsland>
                  </Show>
                </SplitHeaderRight>
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
        </ModalsProvider>
      </MarkdownDocument>
    </DocumentBlockContainer>
  );
}
