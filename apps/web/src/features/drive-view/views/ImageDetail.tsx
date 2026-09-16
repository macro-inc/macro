import { ImageContent } from '@block-image/component/ImageContent';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  type ImageDocumentData,
  loadImageDocument,
} from '../queries/image-document';

export function ImageDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: ImageDocumentData;
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
      <ImageContent
        file={props.data.file}
        alt={props.data.documentMetadata.documentName || 'Image'}
      />
    </FileDetailLayout>
  );
}

export function ImageDetail(
  props: FileDetailShareProps & { documentId: string }
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
        />
      )}
    </FileDetailLoadGate>
  );
}
