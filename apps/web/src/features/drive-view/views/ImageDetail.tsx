import { ImageContent } from '@block-image/component/ImageContent';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { FileDetailLayout, FileDetailLoadGate } from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import {
  type ImageDocumentData,
  loadImageDocument,
} from '../queries/image-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type ImageDetailContext = FileDetailContext<ImageDocumentData>;

export function ImageDetailDocument(props: {
  documentId: string;
  data: ImageDocumentData;
  children?: (context: ImageDetailContext) => JSX.Element;
}) {
  const download = createFileDownload(() => ({
    id: `${props.documentId}:${props.data.documentMetadata.documentVersionId}`,
    name: documentDownloadName(props.data.documentMetadata),
    load: async () => ok({ blob: props.data.file }),
  }));
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
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
        download,
      })}
      <ImageContent
        file={props.data.file}
        alt={props.data.documentMetadata.documentName || 'Image'}
      />
    </FileDetailLayout>
  );
}

export function ImageDetail(props: {
  documentId: string;
  children?: (context: ImageDetailContext) => JSX.Element;
}) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      entityType="image"
      label="image"
      load={loadImageDocument}
    >
      {(data) => (
        <ImageDetailDocument
          documentId={props.documentId}
          data={data}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
