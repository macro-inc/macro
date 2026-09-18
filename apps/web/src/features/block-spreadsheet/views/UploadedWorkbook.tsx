import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import { createQuery } from '@tanstack/solid-query';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { importSpreadsheetSheets } from '../core/workbook-document';
import type { WorkbookFileData } from '../core/workbook-file-types';
import { createDraftActions } from '../primitives/create-draft-actions';
import { createLocalSpreadsheetSource } from '../primitives/create-local-spreadsheet-source';
import { createSpreadsheetStore } from '../primitives/create-spreadsheet-store';
import { importWorkbookFile } from '../primitives/workbook-file-client';
import { createSpreadsheetDocument } from '../queries/create-spreadsheet';
import { saveSpreadsheetDraft } from '../queries/save-spreadsheet-draft';
import { uploadedWorkbookQuery } from '../queries/uploaded-workbook';
import { spreadsheetMentions } from '../spreadsheet-mentions';
import { SpreadsheetEditor } from './SpreadsheetEditor';

/** Used by both the old /unknown URLs and CSV blocks, including channel splits. */
export default function UploadedWorkbook() {
  const id = useBlockId();
  const query = createQuery(() =>
    uploadedWorkbookQuery(
      {
        id,
        version: blockMetadataSignal.get()?.documentVersionId ?? 0,
        fileType: blockMetadataSignal.get()?.fileType ?? '',
      },
      importWorkbookFile
    )
  );
  return (
    <Show
      when={query.isSuccess ? query.data : undefined}
      keyed
      fallback={
        <div
          class="flex size-full flex-col items-center justify-center gap-3 p-6 text-sm text-ink-muted"
          role="status"
        >
          <span>
            {query.isError
              ? query.error instanceof Error
                ? query.error.message
                : 'Unable to open this workbook.'
              : 'Opening spreadsheet…'}
          </span>
          <Show when={query.isError}>
            <Button size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Show>
        </div>
      }
    >
      {(workbook) => <UploadedWorkbookPreview workbook={workbook} />}
    </Show>
  );
}

function UploadedWorkbookPreview(props: { workbook: WorkbookFileData }) {
  const panel = useSplitPanelOrThrow();
  const name = useBlockDocumentName('Imported spreadsheet');
  const source = createLocalSpreadsheetSource();
  importSpreadsheetSheets(source.doc()!, props.workbook.sheets, true);
  const store = createSpreadsheetStore({ source, canEdit: () => false });
  const actions = createDraftActions({
    snapshot: () => source.doc()?.export({ mode: 'snapshot' }),
    context: () => ({}),
    createDocument: () =>
      createSpreadsheetDocument({
        title: name(),
        source: 'spreadsheet-upload',
      }),
    saveDocument: saveSpreadsheetDraft,
    openChat: async () => false,
    openDocument: (id) =>
      panel.handle.replace({
        next: { type: 'spreadsheet', id },
        mergeHistory: true,
        referredFrom: 'entity-actions-menu',
      }),
    onSaveFailure: () =>
      toast.failure('Could not save spreadsheet', {
        subtext: 'Your original file is unchanged. Try converting again.',
      }),
  });
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge-muted px-3 py-2 text-xs text-ink-muted">
        <span>
          Uploaded workbook · Convert to edit and collaborate. The original file
          stays available.
        </span>
        <Button
          size="sm"
          variant="accent"
          disabled={!!actions.pending()}
          onClick={() => void actions.edit()}
        >
          {actions.pending() ? 'Saving…' : 'Edit in Macro'}
        </Button>
        <Show when={props.workbook.warnings.length}>
          <details class="w-full">
            <summary>Import notes ({props.workbook.warnings.length})</summary>
            <ul class="list-disc pl-5 pt-2">
              <For each={props.workbook.warnings}>
                {(warning) => <li>{warning}</li>}
              </For>
            </ul>
          </details>
        </Show>
      </div>
      <SpreadsheetEditor
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
  );
}
