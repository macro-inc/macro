import { SpreadsheetSkeleton } from '@app/features/block-spreadsheet/components/SpreadsheetSkeleton';
import { isUploadedWorkbook } from '@app/features/block-spreadsheet/core/uploaded-workbook';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import { lazyNamed } from '@core/util/lazyNamed';
import { useItemRawName } from '@queries/preview';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { type JSX, Show, Suspense } from 'solid-js';

const UploadedWorkbookFile = lazyNamed(
  () => import('@app/features/block-spreadsheet/views/UploadedWorkbook'),
  'UploadedWorkbookFile'
);

/** Shows uploaded Excel and CSV files as a spreadsheet preview when spreadsheets are enabled. */
export function DriveUploadedWorkbook(props: {
  documentMetadata: DocumentMetadata;
  fallback: JSX.Element;
}) {
  const enabled = useSpreadsheetAccess();
  const liveName = useItemRawName(() => ({
    id: props.documentMetadata.documentId,
    type: 'document',
  }));
  return (
    <Show
      when={enabled() && isUploadedWorkbook(props.documentMetadata.fileType)}
      fallback={props.fallback}
    >
      <Suspense fallback={<SpreadsheetSkeleton />}>
        <UploadedWorkbookFile
          documentId={props.documentMetadata.documentId}
          version={props.documentMetadata.documentVersionId}
          fileType={props.documentMetadata.fileType ?? ''}
          name={
            liveName() ??
            props.documentMetadata.documentName ??
            'Imported spreadsheet'
          }
        />
      </Suspense>
    </Show>
  );
}
