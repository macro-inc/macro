import { UnknownContent } from '@block-unknown/component/UnknownContent';
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import { createSignal, type JSX } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import { getFileDocumentBlob } from '../queries/file-document';
import {
  loadUnknownDocument,
  type UnknownDocumentData,
} from '../queries/unknown-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type UnknownDetailContext = FileDetailContext<UnknownDocumentData>;

export function UnknownDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: UnknownDocumentData;
    children?: (context: UnknownDetailContext) => JSX.Element;
  }
) {
  const [localShareOpen, setLocalShareOpen] = createSignal(false);
  const shareOpen = () => props.shareOpen ?? localShareOpen();
  const setShareOpen = (open: boolean) => {
    props.onShareOpenChange?.(open);
    if (props.shareOpen === undefined) setLocalShareOpen(open);
  };
  const downloadName = () => documentDownloadName(props.data.documentMetadata);

  const downloadDocument = async () => {
    try {
      const file = await getFileDocumentBlob({
        documentId: props.documentId,
        documentVersionId: props.data.documentMetadata.documentVersionId,
      });
      downloadFile(file, downloadName());
    } catch (error) {
      console.error('error downloading file', error);
      toast.failure('Error downloading file');
    }
  };
  const operations = [downloadFileOperation(() => void downloadDocument())];

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType="unknown"
      defaultSidePanelOpen
      shareOpen={shareOpen()}
      onShareOpenChange={setShareOpen}
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <UnknownContent
        fileName={props.data.documentMetadata.documentName}
        onShare={() => setShareOpen(true)}
        onDownload={() => void downloadDocument()}
      />
    </FileDetailLayout>
  );
}

export function UnknownDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: UnknownDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="file"
      load={loadUnknownDocument}
    >
      {(data) => (
        <UnknownDetailDocument
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
