import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
} from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { storageServiceClient } from '@service-storage/client';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';
import { err, ok } from 'neverthrow';
import BlockVideo from './component/Block';
import {
  isVideoPlaybackEnabled,
  PLAYBACK_ENABLED_MIMES,
  VIDEO_MIMES,
} from './core/video';

export { PLAYBACK_ENABLED_MIMES, VIDEO_MIMES };

export const definition = defineBlock({
  name: 'video',
  description: 'block for video file types',
  component: BlockVideo,
  liveTrackingEnabled: false,
  accepted: VIDEO_MIMES,
  async load(source, intent) {
    if (source.type === 'dss') {
      const maybeDocument = await loadResult(
        storageServiceClient.getDocumentMetadata({ documentId: source.id })
      );

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      if (maybeDocument.isErr()) return err(maybeDocument.error);

      const documentResult = maybeDocument.value;
      const { documentMetadata, userAccessLevel } = documentResult;

      const fileType = documentMetadata.fileType;
      let videoUrl: string | undefined;
      if (isVideoPlaybackEnabled(fileType)) {
        videoUrl = await getPresignedUrl({
          documentId: documentMetadata.documentId,
          versionId: documentMetadata.documentVersionId,
        });
      } else {
        toast.failure('Video playback is not supported for this file type', {
          subtext: `File type: ${fileType}`,
        });
      }

      return ok({ documentMetadata, userAccessLevel, videoUrl });
    }
    return LoadErrors.INVALID;
  },
});

export type VideoFileData = ExtractLoadType<(typeof definition)['load']> & {
  videoUrl?: string;
};
