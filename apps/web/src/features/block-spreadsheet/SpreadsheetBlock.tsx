import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { isMobile } from '@core/mobile/isMobile';
import { createMethodRegistration } from '@core/orchestrator';
import { blockElementSignal } from '@core/signal/blockElement';
import { blockHandleSignal, blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import { Badge } from '@ui';
import { onMount, Show } from 'solid-js';
import { spreadsheetChatContext } from './core/chat-context';
import { clipboardTargetInScope } from './core/clipboard-scope';
import type { SpreadsheetData } from './definition';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { useSpreadsheetAccess } from './primitives/use-spreadsheet-access';
import { createSpreadsheetSession } from './queries/spreadsheet-session';
import { SpreadsheetComments } from './SpreadsheetComments';
import { spreadsheetMentions } from './spreadsheet-mentions';
import { SpreadsheetEditor } from './views/SpreadsheetEditor';

export default function SpreadsheetBlock(props: { share?: string }) {
  const enabled = useSpreadsheetAccess();
  const params = createParamsState();
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <ParamsProvider state={params}>
      <Show
        when={enabled()}
        fallback={
          <div class="p-6 text-ink-muted">
            Spreadsheets are not enabled for this account.
          </div>
        }
      >
        <SpreadsheetBlockContent share={props.share} />
      </Show>
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

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderLeft>
          <BlockItemSplitLabel
            trailingBadges={
              <Show when={!isMobile()}>
                <Badge variant="outline" size="xs">
                  Beta
                </Badge>
              </Show>
            }
          />
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <BlockLiveIndicators />
        </SplitHeaderRight>
        <ResponsivePermissionsBadge />
        <ResponsiveBlockToolbar
          id={documentId}
          itemType="document"
          name={name()}
          ops={[
            { op: 'rename' },
            { op: 'copy' },
            { op: 'moveToProject' },
            { op: 'delete' },
          ]}
          tools={[
            {
              group: 'sharing',
              label: 'Share',
              icon: IconShared,
              action: openShare,
              buttonComponent: () => <ShareTrigger onClick={openShare} />,
              focusTarget: getShareDrawerRecipientInput,
            },
          ]}
        />
        <Show when={data()?.syncSource} keyed>
          {(syncSource) => {
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
            return (
              <>
                <SplitHeaderRight>
                  <div class="order-[999] flex items-center">
                    <ChatWithAgentButton
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
                  </div>
                </SplitHeaderRight>
                <SpreadsheetComments documentId={documentId} store={store}>
                  {(commentLocation, comments) => (
                    <SpreadsheetEditor
                      autoFocus={canAutofocus && !navigatedFromJK()}
                      commentLocation={commentLocation()}
                      comments={comments}
                      ownsClipboard={ownsClipboard}
                      mentions={spreadsheetMentions}
                      store={store}
                      name={name()}
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
