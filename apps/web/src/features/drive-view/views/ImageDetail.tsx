import { ImageContent } from '@block-image/component/ImageContent';
import { downloadFile } from '@filesystem/download';
import type { JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import {
  type ImageDocumentData,
  loadImageDocument,
} from '../queries/image-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type ImageDetailContext = FileDetailContext<ImageDocumentData>;

export function ImageDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: ImageDocumentData;
    children?: (context: ImageDetailContext) => JSX.Element;
  }
) {
  const operations = [
    downloadFileOperation(() => {
      downloadFile(
        props.data.file,
        documentDownloadName(props.data.documentMetadata)
      );
    }),
  ];

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="image"
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
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
