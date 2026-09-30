import {
  getFileDocumentBlob,
  loadFileDocumentData,
} from '@app/features/drive-view/queries/file-document';
import { documentDownloadName } from '@app/features/drive-view/util/document-download-name';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import { createContext, type JSX, useContext } from 'solid-js';

export interface DocumentAttachmentActions {
  attachDocument(documentId: string): void;
}

const DocumentAttachmentContext = createContext<DocumentAttachmentActions>();

export const DocumentAttachmentProvider = DocumentAttachmentContext.Provider;

export function useDocumentAttachment(): DocumentAttachmentActions | undefined {
  return useContext(DocumentAttachmentContext);
}

interface CreateDocumentAttachmentActionsOptions {
  onAddAttachments: (attachments: DraftFormAttachment[]) => void;
  onFailure: (message: string) => void;
}

export function createDocumentAttachmentActions(
  options: CreateDocumentAttachmentActionsOptions
): DocumentAttachmentActions {
  return {
    attachDocument: async (documentId: string) => {
      try {
        const documentData = await loadFileDocumentData(documentId);
        const metadata = documentData.documentMetadata;

        const blob = await getFileDocumentBlob({
          documentId,
          documentVersionId: metadata.documentVersionId,
        });

        const fileName = documentDownloadName(metadata);
        const file = new File([blob], fileName, { type: blob.type });

        options.onAddAttachments([{ type: 'local', file }]);
      } catch (error) {
        console.error('Failed to attach document:', error);
        options.onFailure('Failed to attach document');
      }
    },
  };
}

export function DocumentAttachmentContextProvider(props: {
  children: JSX.Element;
  onAddAttachments: (attachments: DraftFormAttachment[]) => void;
  onFailure: (message: string) => void;
}) {
  const actions = createDocumentAttachmentActions({
    onAddAttachments: props.onAddAttachments,
    onFailure: props.onFailure,
  });

  return (
    <DocumentAttachmentProvider value={actions}>
      {props.children}
    </DocumentAttachmentProvider>
  );
}
