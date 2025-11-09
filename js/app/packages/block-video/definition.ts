import {
  defineBlock,
  type ExtractLoadType,
  LoadErrors,
  loadResult,
  type MimeType,
} from '@core/block';
import { ENABLE_VIDEO_BLOCK } from '@core/constant/featureFlags';
import { isErr, ok } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import type { DocumentMetadataFileType } from '@service-storage/generated/schemas/documentMetadataFileType';
import { getPresignedUrl } from '@service-storage/util/presignedUrl';
import { toast } from 'core/component/Toast/Toast';
import BlockVideo from './component/Block';

export const VIDEO_MIMES: Record<
  NonNullable<DocumentMetadataFileType>,
  MimeType
> = ENABLE_VIDEO_BLOCK
  ? {
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      mov: 'video/quicktime',
      wmv: 'video/x-ms-wmv',
      mpg: 'video/mpeg',
      mpeg: 'video/mpeg',
      m4v: 'video/mp4',
      flv: 'video/x-flv',
      f4v: 'video/mp4',
      threegp: 'video/3gpp',
    }
  : {};

export const PLAYBACK_ENABLED_MIMES: Record<keyof typeof VIDEO_MIMES, boolean> =
  {
    mp4: true,
    mkv: true,
    webm: true,
    avi: true,
    mov: true,
    wmv: true,
    mpg: true,
    mpeg: true,
    m4v: true,
    flv: true,
    f4v: true,
    threegp: true,
  };

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

      if (isErr(maybeDocument)) return maybeDocument;

      const [, documentResult] = maybeDocument;

      const { documentMetadata, userAccessLevel } = documentResult;

      const fileType = documentMetadata.fileType;
      let videoUrl: string | undefined;
      if (
        fileType &&
        Object.keys(PLAYBACK_ENABLED_MIMES).includes(fileType) &&
        PLAYBACK_ENABLED_MIMES[fileType]
      ) {
        videoUrl = await getPresignedUrl({
          documentId: documentMetadata.documentId,
          versionId: documentMetadata.documentVersionId,
        });
      } else {
        toast.failure(
          'Video playback is not supported for this file type',
          `File type: ${fileType}`
        );
      }

      return ok({ documentMetadata, userAccessLevel, videoUrl });
    }
    return LoadErrors.INVALID;
  },
});

export type VideoFileData = ExtractLoadType<(typeof definition)['load']>;
