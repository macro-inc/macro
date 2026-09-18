import { VideoContent } from '@block-video/component/VideoContent';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  loadVideoDocument,
  type VideoDocumentData,
} from '../queries/video-document';

export type VideoDetailContext = {
  data: VideoDocumentData;
};

export function VideoDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: VideoDocumentData;
    children?: (context: VideoDetailContext) => JSX.Element;
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
      {props.children?.({ data: props.data })}
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
