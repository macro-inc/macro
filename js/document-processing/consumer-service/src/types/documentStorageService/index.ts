export type DocumentMetadata = {
  documentId: string;
  documentVersionId: number;
  documentName: string;
  owner: string;
  fileType: string;
};

export type DocumentBom = {
  id: string;
  path: string;
  sha: string;
};

export type PdfModificationData = { [name: string]: any };
export type PdfDocument = DocumentMetadata & {
  fileType: 'pdf';
  sha: string;
  modificationData: PdfModificationData;
};
export type DocxDocument = DocumentMetadata & {
  fileType: 'docx';
  documentBom: DocumentBom[];
};

export type GetDocumentResponse = {
  message?: string;
  error: boolean;
  data?: { documentMetadata: DocxDocument | PdfDocument };
};

export type GetFullPdfModificationDataResponse = {
  message?: string;
  error: boolean;
  data?: PdfModificationData;
};

export type GetDocumentKeyResponse = {
  message?: string;
  error: boolean;
  data?: { key: string };
};

export type GetDocumentPermissionResponse = {
  message?: string;
  error: boolean;
  data?: {
    documentPermissions: {
      id: string;
      owner: string;
      isPublic: boolean;
      publicAccessLevel?: string;
    };
  };
};

export type GetDocumentUserAccessLevelResponse =
  | {
      message?: string;
      error: boolean;
    }
  | {
      userAccessLevel: string;
    };
