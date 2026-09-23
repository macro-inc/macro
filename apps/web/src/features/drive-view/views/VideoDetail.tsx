import { VideoContent } from '@block-video/component/VideoContent';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import { getFileDocumentBlob } from '../queries/file-document';
import {
  loadVideoDocument,
  type VideoDocumentData,
} from '../queries/video-document';
import { documentDownloadName } from '../util/document-download-name';
import { downloadWithProgress } from '../util/download-with-progress';
import type { FileDetailContext } from '../util/file-detail-context';

export type VideoDetailContext = FileDetailContext<VideoDocumentData>;

export function VideoDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: VideoDocumentData;
    children?: (context: VideoDetailContext) => JSX.Element;
  }
) {
  const operations = [
    downloadFileOperation(() => {
      const fileName = documentDownloadName(props.data.documentMetadata);
      void downloadWithProgress(fileName, (onProgress) =>
        getFileDocumentBlob(
          {
            documentId: props.documentId,
            documentVersionId: props.data.documentMetadata.documentVersionId,
          },
          { onProgress }
        )
      );
    }),
  ];

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="video"
      defaultSidePanelOpen
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <VideoContent
        videoUrl={props.data.videoUrl}
        fileType={props.data.documentMetadata.fileType}
        notifyUnsupported
      />
    </FileDetailLayout>
  );
}

export function VideoDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: VideoDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="video"
      load={loadVideoDocument}
    >
      {(data) => (
        <VideoDetailDocument
          documentId={props.documentId}
          data={data}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
