import { UnknownContent } from '@block-unknown/component/UnknownContent';
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
import { formatDocumentName } from '@service-storage/util/filename';
import { createSignal } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { getFileDocumentBlob } from '../queries/file-document';
import {
  loadUnknownDocument,
  type UnknownDocumentData,
} from '../queries/unknown-document';

export function UnknownDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: UnknownDocumentData;
  }
) {
  const [localShareOpen, setLocalShareOpen] = createSignal(false);
  const shareOpen = () => props.shareOpen ?? localShareOpen();
  const setShareOpen = (open: boolean) => {
    props.onShareOpenChange?.(open);
    if (props.shareOpen === undefined) setLocalShareOpen(open);
  };
  const downloadName = () =>
    formatDocumentName(
      props.data.documentMetadata.documentName || 'download',
      props.data.documentMetadata.fileType,
      { caseInsensitiveSuffix: true }
    );

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
      <UnknownContent
        fileName={props.data.documentMetadata.documentName}
        onShare={() => setShareOpen(true)}
        onDownload={() => void downloadDocument()}
      />
    </FileDetailLayout>
  );
}

export function UnknownDetail(
  props: FileDetailShareProps & { documentId: string }
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
        />
      )}
    </FileDetailLoadGate>
  );
}
