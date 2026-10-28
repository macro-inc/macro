import type { MimeType } from '@core/block';
import { ENABLE_VIDEO_BLOCK } from '@core/constant/featureFlags';
import type { DocumentMetadataFileType } from '@service-storage/generated/schemas/documentMetadataFileType';

const SUPPORTED_VIDEO_MIMES = {
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
} as const satisfies Record<string, MimeType>;

type SupportedVideoFileType = keyof typeof SUPPORTED_VIDEO_MIMES;

export const VIDEO_MIMES = ENABLE_VIDEO_BLOCK ? SUPPORTED_VIDEO_MIMES : {};

export const PLAYBACK_ENABLED_MIMES = {
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
} as const satisfies Record<SupportedVideoFileType, boolean>;

export function isVideoPlaybackEnabled(
  fileType: DocumentMetadataFileType | undefined
): fileType is SupportedVideoFileType {
  return (
    fileType != null &&
    fileType in PLAYBACK_ENABLED_MIMES &&
    PLAYBACK_ENABLED_MIMES[fileType as SupportedVideoFileType]
  );
}
