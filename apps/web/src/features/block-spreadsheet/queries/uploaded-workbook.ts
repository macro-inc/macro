import { throwOnErr } from '@core/util/result';
import { fetchPresignedBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';
import { decodeCsv } from '../core/uploaded-workbook';
import {
  CSV_MAX_BYTES,
  type WorkbookFileData,
  XLSX_MAX_BYTES,
} from '../core/workbook-file-types';
import { uploadedWorkbookKeys } from './keys';

/** Cache by immutable file version; a failed/cancelled import never writes a doc. */
export function uploadedWorkbookQuery(
  args: { id: string; version: number; fileType: string },
  decodeExcel: (
    bytes: Uint8Array,
    signal: AbortSignal
  ) => Promise<WorkbookFileData>
) {
  return {
    queryKey: uploadedWorkbookKeys.file(args.id, args.version, args.fileType)
      .queryKey,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const url = await getPresignedUrl({
        documentId: args.id,
        versionId: args.version,
      });
      const csv = args.fileType.toLowerCase() === 'csv';
      signal.throwIfAborted();
      const blob = await throwOnErr(() =>
        fetchPresignedBlobWithProgress(
          url,
          () => {},
          { signal },
          csv ? CSV_MAX_BYTES : XLSX_MAX_BYTES
        )
      );
      if (!blob) throw new Error('This file is empty.');
      if (blob.size > (csv ? CSV_MAX_BYTES : XLSX_MAX_BYTES))
        throw new Error(
          `Import ${csv ? 'a CSV' : 'an Excel workbook'} up to ${(csv ? CSV_MAX_BYTES : XLSX_MAX_BYTES) / 1024 / 1024} MB.`
        );
      if (signal.aborted) throw new Error('Import cancelled.');
      if (csv) return decodeCsv(await blob.text());
      return decodeExcel(new Uint8Array(await blob.arrayBuffer()), signal);
    },
  };
}
