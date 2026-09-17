import { ImageContent } from '@block-image/component/ImageContent';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  type ImageDocumentData,
  loadImageDocument,
} from '../queries/image-document';

export type ImageDetailContext = {
  data: ImageDocumentData;
};

export function ImageDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: ImageDocumentData;
    children?: (context: ImageDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="image"
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      {props.children?.({ data: props.data })}
      <ImageContent
        file={props.data.file}
        alt={props.data.documentMetadata.documentName || 'Image'}
      />
    </FileDetailLayout>
  );
}

export function ImageDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: ImageDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="image"
      load={loadImageDocument}
    >
      {(data) => (
        <ImageDetailDocument
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
