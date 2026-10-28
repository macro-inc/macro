import type { DownloadSource } from '@core/util/createFileDownload';
import type { CallRecord } from '@service-call/client';
import { fetchPresignedBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { fileExtension } from '@service-storage/util/filename';

/**
 * A call's recording, saved under the call's name with the recording's own
 * extension, or undefined while the call has no recording.
 */
export function callRecordingDownloadSource(
  record: CallRecord,
  callName: string
): DownloadSource | undefined {
  const url = record.recordingUrl;
  if (!url) return undefined;
  return {
    // The presigned URL is re-signed on every refetch; the call is stable.
    id: record.callId,
    name: callName,
    load: async ({ signal, onProgress }) => {
      const fileName = new URL(url).pathname.split('/').at(-1);
      const name = `${callName}.${fileExtension(fileName) ?? 'mp4'}`;
      const result = await fetchPresignedBlobWithProgress(url, onProgress, {
        signal,
      });
      return result.map((blob) => ({ blob, name }));
    },
  };
}
