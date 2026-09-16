import { VideoContent } from '@block-video/component/VideoContent';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  loadVideoDocument,
  type VideoDocumentData,
} from '../queries/video-document';

export function VideoDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: VideoDocumentData;
  }
) {
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
      <VideoContent
        videoUrl={props.data.videoUrl}
        fileType={props.data.documentMetadata.fileType}
        notifyUnsupported
      />
    </FileDetailLayout>
  );
}

export function VideoDetail(
  props: FileDetailShareProps & { documentId: string }
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
        />
      )}
    </FileDetailLoadGate>
  );
}
