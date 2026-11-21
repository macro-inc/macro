import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import { blockElementSignal } from '@core/signal/blockElement';
import { blockHandleSignal, blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { spreadsheetChatContext } from './core/chat-context';
import { clipboardTargetInScope } from './core/clipboard-scope';
import type { SpreadsheetData } from './definition';
import { createSpreadsheetDownload } from './primitives/create-spreadsheet-download';
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { createSpreadsheetSession } from './queries/spreadsheet-session';
import { SpreadsheetComments } from './SpreadsheetComments';
import { spreadsheetMentions } from './spreadsheet-mentions';
import { MobileSpreadsheetHeader } from './views/mobile/spreadsheet-header';
import { SpreadsheetEditor } from './views/SpreadsheetEditor';
import { SpreadsheetHeader } from './views/spreadsheet-header';

export default function SpreadsheetBlock(props: { share?: string }) {
  const params = createParamsState();
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <ParamsProvider state={params}>
      <SpreadsheetBlockContent share={props.share} />
    </ParamsProvider>
  );
}

function SpreadsheetBlockContent(props: { share?: string }) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('New Spreadsheet');
  const canEdit = useCanEdit();
  const userId = useUserId();
  const permissions = useGetPermissions();
  const splitPanel = useSplitPanel();
  const blockElement = blockElementSignal.get;
  const ownsClipboard = (event: ClipboardEvent) =>
    !!splitPanel?.isPanelActive() &&
    clipboardTargetInScope(event.target, {
      block: blockElement(),
      // An inline preview shares its host's panel with the host's own content.
      panel: splitPanel.isInlinePreview
        ? undefined
        : (splitPanel.panelRef() ?? undefined),
      chrome: Object.values(splitPanel.layoutRefs),
    });
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'spreadsheet',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  onMount(() => {
    if (props.share === 'true') openShare();
  });
  const data = () => {
    const value = blockDataSignal.get() as
      | (SpreadsheetData & { __block?: string })
      | undefined;
    return value?.__block === 'spreadsheet' ? value : undefined;
  };
  const sheetDownload = createSpreadsheetDownload();
  // The open sheet's store, so the header's Ask Macro sends the selection
  // the editor's button does.
  const [sheetStore, setSheetStore] = createSignal<SpreadsheetStore>();
  const chatContext = () => {
    const store = sheetStore();
    if (!store?.ready()) return undefined;
    return spreadsheetChatContext(store.activeSheet(), store.selection());
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show
          when={isTouchDevice()}
          fallback={
            <SpreadsheetHeader
              documentId={documentId}
              name={() => name() ?? ''}
              openShare={openShare}
              download={sheetDownload.download}
              chatContext={chatContext}
            />
          }
        >
          <MobileSpreadsheetHeader
            documentId={documentId}
            name={() => name() ?? ''}
            openShare={openShare}
            download={sheetDownload.download}
            chatContext={chatContext}
          />
        </Show>
        <Show when={data()?.syncSource} keyed>
          {(syncSource) => {
            onCleanup(sheetDownload.clear);
            const source = createSpreadsheetSession({
              documentId,
              userId: userId(),
              canEdit,
              syncSource,
              doInitialSync: data()!.doInitialSync,
            });
            const store = createSpreadsheetStore({
              source: {
                ...source,
                peers: () =>
                  source.peers().map((peer) => ({
                    ...peer,
                    name: getDisplayName(tryMacroId(peer.userId ?? ''), {
                      emailFallback: 'local-part',
                    }),
                  })),
              },
              canEdit,
            });
            setSheetStore(store);
            onCleanup(() =>
              setSheetStore((current) =>
                current === store ? undefined : current
              )
            );
            return (
              <>
                <SplitHeaderRight>
                  <div class="order-[999] flex items-center">
                    <HeaderActionGroup label="Spreadsheet actions">
                      <ChatWithAgentButton
                        grouped
                        label="Ask Macro"
                        disabled={!store.ready()}
                        entity={{
                          type: 'document',
                          id: documentId,
                          name: name(),
                          fileType: 'spreadsheet',
                          blockParams: spreadsheetChatContext(
                            store.activeSheet(),
                            store.selection()
                          ),
                        }}
                      />
                    </HeaderActionGroup>
                  </div>
                </SplitHeaderRight>
                <SpreadsheetComments documentId={documentId} store={store}>
                  {(commentLocation, comments) => (
                    <SpreadsheetEditor
                      documentId={documentId}
                      autoFocus={canAutofocus && !navigatedFromJK()}
                      commentLocation={commentLocation()}
                      comments={comments}
                      ownsClipboard={ownsClipboard}
                      mentions={spreadsheetMentions}
                      store={store}
                      name={name()}
                      onDownloadReady={sheetDownload.register}
                      onExportXlsx={(bytes) =>
                        downloadFile(
                          new Blob([bytes.slice().buffer], {
                            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                          }),
                          `${name()}.xlsx`
                        )
                      }
                      onExport={(content) =>
                        downloadFile(
                          new Blob([content], {
                            type: 'text/csv;charset=utf-8',
                          }),
                          `${name()}.csv`
                        )
                      }
                    />
                  )}
                </SpreadsheetComments>
              </>
            );
          }}
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
