import type { DownloadSource } from '@core/util/createFileDownload';
import type { CallRecord } from '@service-call/client';
import { fetchPresignedBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { fileExtension } from '@service-storage/util/filename';

/**
 * A call's recording, saved under `fileName` with the recording's own
 * extension, or undefined while it has no recording. `part` picks one of the
 * record's sessions (0-based); without it this is the first session's
 * recording, the record's own `recordingUrl`.
 */
export function callRecordingDownloadSource(
  record: CallRecord,
  fileName: string,
  part?: number
): DownloadSource | undefined {
  const url =
    part === undefined
      ? record.recordingUrl
      : record.sessions[part]?.recordingUrl;
  if (!url) return undefined;
  return {
    // The presigned URL is re-signed on every refetch; the call and part are stable.
    id: part === undefined ? record.callId : `${record.callId}:${part}`,
    name: fileName,
    load: async ({ signal, onProgress }) => {
      const urlFileName = new URL(url).pathname.split('/').at(-1);
      const name = `${fileName}.${fileExtension(urlFileName) ?? 'mp4'}`;
      const result = await fetchPresignedBlobWithProgress(url, onProgress, {
        signal,
      });
      return result.map((blob) => ({ blob, name }));
    },
  };
}
