import { VideoContent } from '@block-video/component/VideoContent';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { getFileDocumentBlob } from '@queries/storage/file-document';
import type { JSX } from 'solid-js';
import { FileDetailLayout, FileDetailLoadGate } from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import {
  loadVideoDocument,
  type VideoDocumentData,
} from '../queries/video-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type VideoDetailContext = FileDetailContext<VideoDocumentData>;

export function VideoDetailDocument(props: {
  documentId: string;
  data: VideoDocumentData;
  children?: (context: VideoDetailContext) => JSX.Element;
}) {
  const download = createFileDownload(() => {
    const documentId = props.documentId;
    const metadata = props.data.documentMetadata;
    return {
      id: `${documentId}:${metadata.documentVersionId}`,
      name: documentDownloadName(metadata),
      load: (options) =>
        catchToResult(async () => ({
          blob: await getFileDocumentBlob(
            { documentId, documentVersionId: metadata.documentVersionId },
            options
          ),
        })),
    };
  });
  const operations = [
    downloadFileOperation(() =>
      fireAndForget(download.start(), 'drive-file-download')
    ),
  ];

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      defaultSidePanelOpen
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
        download,
      })}
      <VideoContent
        videoUrl={props.data.videoUrl}
        fileType={props.data.documentMetadata.fileType}
        notifyUnsupported
      />
    </FileDetailLayout>
  );
}

export function VideoDetail(props: {
  documentId: string;
  children?: (context: VideoDetailContext) => JSX.Element;
}) {
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
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
