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
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import IconShared from '@phosphor/share.svg';
import { Button, Dialog } from '@ui';
import { createSignal } from 'solid-js';

import { spreadsheetChatContext } from './core/chat-context';
import type { SpreadsheetCells } from './core/spreadsheet-document';
import { createDraftActions } from './primitives/create-draft-actions';
import { createLocalSpreadsheetSource } from './primitives/create-local-spreadsheet-source';
import { createSpreadsheetStore } from './primitives/create-spreadsheet-store';
import { createSpreadsheetDocument } from './queries/create-spreadsheet';
import { saveSpreadsheetDraft } from './queries/save-spreadsheet-draft';
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

/** A local workbook that becomes a saved document when shared or attached to chat. */
export default function SpreadsheetDemo() {
  const panel = useSplitPanelOrThrow();
  const [name, setName] = createSignal('Launch budget');
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal<string>();
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

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={name()}
          iconType="spreadsheet"
          onRename={canRename() ? setName : undefined}
          renameAriaLabel="Spreadsheet name"
        />
      </SplitHeaderLeft>
      <SplitTitleFileMenu>
        <SpreadsheetDraftMenu
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          onAsk={() => void actions.ask()}
          onShare={() => void actions.share()}
          onRename={
            canRename()
              ? () => {
                  // Let the menu restore focus before the dialog claims it.
                  requestAnimationFrame(() => setRenameDraft(name()));
                }
              : undefined
          }
        />
      </SplitTitleFileMenu>
      <SplitHeaderRight>
        <div class="order-[1000] flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            class="bg-surface"
            disabled={!!actions.pending()}
            aria-busy={actions.pending() === 'ask'}
            onClick={() => void actions.ask()}
          >
            <ChatWithAgentIcon />
            Ask Macro
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="bg-surface"
            disabled={!!actions.pending()}
            aria-busy={actions.pending() === 'share'}
            onClick={() => void actions.share()}
          >
            <IconShared />
            {actions.pending() === 'share' ? 'Saving…' : 'Share'}
          </Button>
        </div>
      </SplitHeaderRight>
      <Dialog
        open={renameDraft() !== undefined}
        onOpenChange={(open) => {
          if (!open) setRenameDraft(undefined);
        }}
        position="center"
        class="w-96"
      >
        <form
          class="p-5 text-ink"
          onSubmit={(event) => {
            event.preventDefault();
            const next = renameDraft()?.trim();
            if (!next || !canRename()) return;
            setName(next);
            setRenameDraft(undefined);
          }}
        >
          <Dialog.Title class="mb-2 text-sm font-semibold">
            Rename spreadsheet
          </Dialog.Title>
          <Dialog.Description class="mb-4 text-sm text-ink-muted">
            Choose a name for this spreadsheet.
          </Dialog.Description>
          <input
            aria-label="Spreadsheet name"
            class="h-9 w-full rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent"
            value={renameDraft() ?? ''}
            onInput={(event) => setRenameDraft(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div class="mt-5 flex justify-end gap-2">
            <Button size="sm" onClick={() => setRenameDraft(undefined)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="accent"
              type="submit"
              disabled={!renameDraft()?.trim() || !canRename()}
            >
              Save name
            </Button>
          </div>
        </form>
      </Dialog>
      <div class="min-h-0 min-w-0 flex-1">
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
      </div>
    </div>
  );
}
