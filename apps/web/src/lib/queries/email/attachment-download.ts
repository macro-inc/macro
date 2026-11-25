import type { DownloadSource } from '@core/util/createFileDownload';
import { webviewFetch } from '@core/util/platformFetch';
import { catchToResult } from '@core/util/result';
import { fetchBlobWithProgress } from '@service-storage/util/fetchPresigned';
import { err } from 'neverthrow';
import { getEmailAttachmentDownloadUrl } from './attachment';

type DownloadableAttachment = {
  db_id: string;
  filename?: string | null;
  mime_type?: string | null;
};

/**
 * An email attachment's bytes under its original name, read from a fresh
 * authorized URL. The URL is on the attachments CloudFront distribution,
 * which the native apps' HTTP client is not allowed to reach, so the webview
 * fetches it itself; the distribution answers CORS for the app's origins.
 */
export function emailAttachmentDownloadSource(
  attachment: DownloadableAttachment
): DownloadSource {
  const name = attachment.filename || 'attachment';
  return {
    id: attachment.db_id,
    name,
    load: async ({ signal, onProgress, span }) => {
      span.setAttr('email.attachment_id', attachment.db_id);
      const url = await catchToResult(() =>
        getEmailAttachmentDownloadUrl(attachment.db_id)
      );
      if (url.isErr()) return err(url.error);
      const blob = await fetchBlobWithProgress(
        webviewFetch,
        url.value,
        onProgress,
        { signal }
      );
      return blob.map((bytes) => ({
        blob: attachment.mime_type
          ? new Blob([bytes], { type: attachment.mime_type })
          : bytes,
        name,
      }));
    },
  };
}
