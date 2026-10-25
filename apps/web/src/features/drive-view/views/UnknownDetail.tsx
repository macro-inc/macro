import { UnknownContent } from '@block-unknown/component/UnknownContent';
import { getPermissions } from '@core/component/SharePermissions';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { getFileDocumentBlob } from '@queries/storage/file-document';
import type { JSX } from 'solid-js';
import { FileDetailLayout, FileDetailLoadGate } from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
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
      <UnknownContent
        fileName={props.data.documentMetadata.documentName}
        onShare={openShare}
        onDownload={() =>
          fireAndForget(download.start(), 'drive-file-download')
        }
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
