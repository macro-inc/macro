import {
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSplitTitleRename } from '@components/app/split-layout/title-rename';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import { Button } from '@ui';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { spreadsheetChatContext } from './core/chat-context';
import type { SpreadsheetCells } from './core/spreadsheet-document';
import { createDraftActions } from './primitives/create-draft-actions';
import { createLocalSpreadsheetSource } from './primitives/create-local-spreadsheet-source';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { createSpreadsheetDocument } from './queries/create-spreadsheet';
import { saveSpreadsheetDraft } from './queries/save-spreadsheet-draft';
import { spreadsheetMentions } from './spreadsheet-mentions';
import { SpreadsheetDraftMenu } from './views/SpreadsheetDraftMenu';
import { SpreadsheetEditor } from './views/SpreadsheetEditor';

const sample: SpreadsheetCells = {
  A1: { value: 'LAUNCH BUDGET', bold: true },
  A3: { value: 'Workstream', bold: true },
  B3: { value: 'Planned', bold: true },
  C3: { value: 'Actual', bold: true },
  D3: { value: 'Remaining', bold: true },
  E3: { value: 'Used', bold: true },
  A4: { value: 'Design' },
  B4: { value: '4500', format: 'currency' },
  C4: { value: '3200', format: 'currency' },
  D4: { value: '=B4-C4', format: 'currency' },
  E4: { value: '=C4/B4', format: 'percent' },
  A5: { value: 'Engineering' },
  B5: { value: '12000', format: 'currency' },
  C5: { value: '8600', format: 'currency' },
  D5: { value: '=B5-C5', format: 'currency' },
  E5: { value: '=C5/B5', format: 'percent' },
  A6: { value: 'Content' },
  B6: { value: '2400', format: 'currency' },
  C6: { value: '1750', format: 'currency' },
  D6: { value: '=B6-C6', format: 'currency' },
  E6: { value: '=C6/B6', format: 'percent' },
  A7: { value: 'Launch' },
  B7: { value: '3600', format: 'currency' },
  C7: { value: '900', format: 'currency' },
  D7: { value: '=B7-C7', format: 'currency' },
  E7: { value: '=C7/B7', format: 'percent' },
  A9: { value: 'Total', bold: true },
  B9: { value: '=SUM(B4:B7)', format: 'currency', bold: true },
  C9: { value: '=SUM(C4:C7)', format: 'currency', bold: true },
  D9: { value: '=SUM(D4:D7)', format: 'currency', bold: true },
  E9: { value: '=C9/B9', format: 'percent', bold: true },
};

/** The draft is not an entity yet; its header renames it under this id. */
const DRAFT_TITLE_ID = 'spreadsheet-draft';

/** A local workbook that becomes a saved document when shared or attached to chat. */
export default function SpreadsheetDemo() {
  const panel = useSplitPanelOrThrow();
  const [name, setName] = createSignal('Launch budget');
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [documentCreated, setDocumentCreated] = createSignal(false);
  const source = createLocalSpreadsheetSource(sample);
  const store = createSpreadsheetStore({
    source,
    canEdit: () => !actions.pending(),
  });
  const actions = createDraftActions({
    snapshot: () => source.doc()?.export({ mode: 'snapshot' }),
    context: () =>
      spreadsheetChatContext(store.activeSheet(), store.selection()),
    createDocument: async () => {
      const id = await createSpreadsheetDocument({
        title: name(),
        source: 'spreadsheet-demo',
      });
      // A failed content save reuses this document on retry. Its persisted title
      // can be renamed through the normal document menu once it has opened.
      if (id) setDocumentCreated(true);
      return id;
    },
    saveDocument: saveSpreadsheetDraft,
    openChat: (id, blockParams) =>
      openChatWithAgent({
        type: 'document',
        id,
        name: name(),
        fileType: 'spreadsheet',
        blockParams,
      }),
    openDocument: (id, action) =>
      panel.handle.replace({
        next: {
          type: 'spreadsheet',
          id,
          ...(action === 'share' ? { params: { share: 'true' } } : {}),
        },
        mergeHistory: true,
        referredFrom: 'entity-actions-menu',
      }),
    onSaveFailure: (action) =>
      toast.failure('Could not save spreadsheet', {
        subtext: `Your changes are still here. Try ${action === 'share' ? 'sharing' : 'Ask Macro'} again.`,
      }),
  });

  const canRename = () => !actions.pending() && !documentCreated();
  const titleRename = createSplitTitleRename(panel, {
    id: () => DRAFT_TITLE_ID,
    name,
    enabled: canRename,
    rename: (next) => {
      setName(next);
      return okAsync(undefined);
    },
    failureMessage: (failure: never) => failure,
  });

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={name()}
          iconType="spreadsheet"
          id={DRAFT_TITLE_ID}
        />
      </SplitHeaderLeft>
      <SplitTitleFileMenu>
        <SpreadsheetDraftMenu
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          onAsk={() => fireAndForget(actions.ask(), 'spreadsheet-draft')}
          onShare={() => fireAndForget(actions.share(), 'spreadsheet-draft')}
          onRename={
            canRename() ? () => titleRename.begin(DRAFT_TITLE_ID) : undefined
          }
        />
      </SplitTitleFileMenu>
      <SplitHeaderRight>
        <div class="order-[1000] flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            class="bg-surface"
            disabled={!!actions.pending()}
            aria-busy={actions.pending() === 'ask'}
            onClick={() => fireAndForget(actions.ask(), 'spreadsheet-draft')}
          >
            <ChatWithAgentIcon class="size-3.5" />
            Ask Macro
          </Button>
          <Button
            variant="secondary"
            size="sm"
            class="bg-surface"
            disabled={!!actions.pending()}
            aria-busy={actions.pending() === 'share'}
            onClick={() => fireAndForget(actions.share(), 'spreadsheet-draft')}
          >
            <IconShared class="size-3 touch:size-6 shrink-0 pointer-events-none" />
            {actions.pending() === 'share' ? 'Saving…' : 'Share'}
          </Button>
        </div>
      </SplitHeaderRight>
      <div class="min-h-0 min-w-0 flex-1">
        <SpreadsheetEditor
          autoFocus={!panel.isInlinePreview}
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
              new Blob([content], { type: 'text/csv;charset=utf-8' }),
              `${name()}.csv`
            )
          }
        />
      </div>
    </div>
  );
}
