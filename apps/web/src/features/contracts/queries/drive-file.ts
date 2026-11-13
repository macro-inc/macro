import { fetchBinaryDocumentData } from '@app/lib/queries/storage/binary-document';
import { storageServiceClient } from '@service-storage/client';
import { fetchBinary } from '@service-storage/util/fetchBinary';
import { err, ok, type Result } from 'neverthrow';

/** Why a Drive document could not be handed over as a PDF file. */
export type DriveFileError = 'not_pdf' | 'unavailable';

/**
 * A Drive document as a PDF file named after it. The document's type is read
 * first, so a note or a spreadsheet is refused at once instead of waiting for
 * a file location it will never have.
 */
export async function fetchDrivePdf(
  documentId: string
): Promise<Result<File, DriveFileError>> {
  const metadata = await storageServiceClient.getDocumentMetadata({
    documentId,
  });
  if (metadata.isErr()) return err('unavailable');
  const { documentName, fileType } = metadata.value.documentMetadata;
  if (fileType !== 'pdf') return err('not_pdf');

  const location = await fetchBinaryDocumentData(documentId);
  if (location.isErr()) return err('unavailable');
  const bytes = await fetchBinary(location.value.blobUrl, 'arraybuffer');
  if (bytes.isErr()) return err('unavailable');

  return ok(new File([bytes.value], `${documentName}.pdf`));
}
