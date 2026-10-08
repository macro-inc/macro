import { UnknownContent } from '@block-unknown/component/UnknownContent';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { downloadFile } from '@filesystem/download';
import type { JSX } from 'solid-js';
import { FileDetailLayout, FileDetailLoadGate } from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import { getFileDocumentBlob } from '../queries/file-document';
import {
  loadUnknownDocument,
  type UnknownDocumentData,
} from '../queries/unknown-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type UnknownDetailContext = FileDetailContext<UnknownDocumentData>;

export function UnknownDetailDocument(props: {
  documentId: string;
  data: UnknownDocumentData;
  children?: (context: UnknownDetailContext) => JSX.Element;
}) {
  const openShare = useShareModal(() => ({
    id: props.documentId,
    blockAlias: 'unknown',
    itemType: 'document',
    name: props.data.documentMetadata.documentName,
    userPermissions: getPermissions(props.data.userAccessLevel),
    owner: props.data.documentMetadata.owner,
  }));
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
      defaultSidePanelOpen
    >
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <UnknownContent
        fileName={props.data.documentMetadata.documentName}
        onShare={openShare}
        onDownload={() => void downloadDocument()}
      />
    </FileDetailLayout>
  );
}

export function UnknownDetail(props: {
  documentId: string;
  children?: (context: UnknownDetailContext) => JSX.Element;
}) {
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
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
