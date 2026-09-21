import { isVideoPlaybackEnabled } from '@block-video/core/video';
import {
  type FileDocumentData,
  getFileDocumentUrl,
  loadFileDocumentData,
} from './file-document';

export type VideoDocumentData = FileDocumentData & {
  videoUrl?: string;
};

export async function loadVideoDocument(
  documentId: string
): Promise<VideoDocumentData> {
  const data = await loadFileDocumentData(documentId);
  if (!isVideoPlaybackEnabled(data.documentMetadata.fileType)) return data;

  const videoUrl = await getFileDocumentUrl({
    documentId,
    documentVersionId: data.documentMetadata.documentVersionId,
  });
  return { ...data, videoUrl };
}
