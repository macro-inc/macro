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
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { useCanEdit } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@phosphor/share.svg';
import { Show } from 'solid-js';
import { spreadsheetChatContext } from './core/chat-context';
import type { SpreadsheetData } from './definition';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { useSpreadsheetAccess } from './primitives/use-spreadsheet-access';
import { createSpreadsheetSession } from './queries/spreadsheet-session';
import { SpreadsheetEditor } from './views/SpreadsheetEditor';
import { SpreadsheetModalsProvider } from './views/SpreadsheetModalsProvider';

export default function SpreadsheetBlock(props: { share?: string }) {
  const enabled = useSpreadsheetAccess();
  return (
    <Show
      when={enabled()}
      fallback={
        <div class="p-6 text-ink-muted">
          Spreadsheets are not enabled for this account.
        </div>
      }
    >
      <SpreadsheetModalsProvider share={props.share}>
        <SpreadsheetBlockContent />
      </SpreadsheetModalsProvider>
    </Show>
  );
}

function SpreadsheetBlockContent() {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('New Spreadsheet');
  const canEdit = useCanEdit();
  const userId = useUserId();
  const share = useShareDialogContext();
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
          <BlockItemSplitLabel />
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
              action: () => share.open(),
              buttonComponent: () => <ShareTrigger />,
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
                <SpreadsheetEditor
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
                      new Blob([content], { type: 'text/csv;charset=utf-8' }),
                      `${name()}.csv`
                    )
                  }
                />
              </>
            );
          }}
        </Show>
      </div>
    </DocumentBlockContainer>
  );
}
