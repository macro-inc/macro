import type { DownloadSource } from '@core/util/createFileDownload';
import { staticFileClient } from '@service-static-files/client';
import type { MediaItem } from '../Media/media-items';

export function mediaDownloadSource(item: MediaItem): DownloadSource {
  return {
    id: item.id,
    name: 'Video',
    load: async (options) => {
      const [metadata, result] = await Promise.all([
        staticFileClient.getMetadata({ file_id: item.id }),
        staticFileClient.getFileBlob({ file_id: item.id }, options),
      ]);
      return result.map((blob) => {
        const extension = new Map([
          ['video/mp4', 'mp4'],
          ['video/quicktime', 'mov'],
          ['video/webm', 'webm'],
          ['video/ogg', 'ogv'],
          ['video/x-matroska', 'mkv'],
        ]).get(blob.type.split(';')[0].trim());
        return {
          blob,
          name:
            (metadata.isOk() && metadata.value.file_name) ||
            `video-${item.id}${extension ? `.${extension}` : ''}`,
        };
      });
    },
  };
}
