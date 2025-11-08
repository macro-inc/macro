import { createHash } from 'crypto';
import { insertDocxUploadJobEntry } from '../handlers/docxUploadJob';
import type {
  DocxDocument,
  GetDocumentKeyResponse,
  GetDocumentPermissionResponse,
  GetDocumentResponse,
  GetDocumentUserAccessLevelResponse,
  GetFullPdfModificationDataResponse,
  PdfDocument,
} from '../types/documentStorageService';
import type { Logger } from '../utils/logger';
import { macroDB } from './macrodbService';

const MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY =
  'x-document-storage-service-auth-key';
const MACRO_INTERNAL_USER_ID_HEADER_KEY = 'x-document-storage-service-user-id';
// At the moment this is not needed but leaving here in case it is needed in future.
// const MACRO_INTERNAL_SESSION_ID_HEADER_KEY = 'x-document-storage-service-session-id';

export class DocumentStorageService {
  private logger: Logger;
  private baseUrl: string;
  private authKey: string;

  constructor(baseUrl: string, authKey: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.authKey = authKey;
    this.logger = logger;
    this.logger.debug('initiated DocumentStorageService', { baseUrl });
  }

  async health() {
    return fetch(`${this.baseUrl}/health`);
  }

  // Gets a specific document by its document id
  async get_document(documentId: string): Promise<GetDocumentResponse> {
    this.logger.debug('get_document', {
      documentId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(`${this.baseUrl}/internal/documents/${documentId}`, {
        method: 'GET',
        headers: {
          [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
        },
      })
    ).json();
  }

  // Gets full PDF modification data for a document
  async get_full_pdf_modification_data(
    documentId: string
  ): Promise<GetFullPdfModificationDataResponse> {
    this.logger.debug('get_full_pdf_modification_data', {
      documentId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(
        `${this.baseUrl}/internal/documents/${documentId}/full_pdf_modification_data`,
        {
          method: 'GET',
          headers: {
            [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
          },
        }
      )
    ).json();
  }

  // Gets a specific document by its document id and version id
  async get_document_version(
    documentId: string,
    documentVersionId: number
  ): Promise<GetDocumentResponse> {
    this.logger.debug('get_document_version', {
      documentId,
      documentVersionId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(
        `${this.baseUrl}/internal/documents/${documentId}/${documentVersionId}`,
        {
          method: 'GET',
          headers: {
            [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
          },
        }
      )
    ).json();
  }

  // Gets the document key for a particular pdf
  async get_document_key(
    documentId: string,
    documentVersionId: number
  ): Promise<GetDocumentKeyResponse> {
    this.logger.debug('get_document_key', {
      documentId,
      documentVersionId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(
        `${this.baseUrl}/internal/documents/${documentId}/${documentVersionId}/key`,
        {
          method: 'GET',
          headers: {
            [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
          },
        }
      )
    ).json();
  }

  async get_document_permissions(
    documentId: string
  ): Promise<GetDocumentPermissionResponse> {
    this.logger.debug('get_document_permissions', {
      documentId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(
        `${this.baseUrl}/internal/documents/${documentId}/permissions`,
        {
          method: 'GET',
          headers: {
            [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
          },
        }
      )
    ).json();
  }

  async get_document_user_access_level(
    documentId: string,
    userId: string
  ): Promise<GetDocumentUserAccessLevelResponse> {
    this.logger.debug('get_document_user_access_level', {
      documentId,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return (
      await fetch(
        `${this.baseUrl}/internal/documents/${documentId}/access_level`,
        {
          method: 'GET',
          headers: {
            [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
            [MACRO_INTERNAL_USER_ID_HEADER_KEY]: userId,
          },
        }
      )
    ).json();
  }

  async create_docx_document({
    buffer,
    documentName,
    owner,
    documentFamilyId,
    branchedFromId,
    branchedFromVersionId,
    jobId,
    jobType,
  }: {
    buffer: Buffer;
    documentName: string;
    owner: string;
    documentFamilyId?: number;
    branchedFromId?: string;
    branchedFromVersionId?: number;
    jobId: string;
    jobType: string;
  }): Promise<DocxDocument> {
    const metadata = { jobId, jobType, documentName, owner };
    this.logger.debug('create_docx_document', metadata);
    const hash = createHash('sha256');
    hash.update(buffer);
    const sha = hash.digest('hex');

    // Encode sha as base64
    const base64Sha = Buffer.from(sha, 'hex').toString('base64');

    const response = await fetch(`${this.baseUrl}/internal/documents`, {
      method: 'POST',
      body: JSON.stringify({
        documentName,
        owner,
        fileType: 'docx',
        sha,
        isShareable: false,
        documentFamilyId,
        branchedFromId,
        branchedFromVersionId,
      }),
      headers: {
        [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
        [MACRO_INTERNAL_USER_ID_HEADER_KEY]: owner,
        'Content-Type': 'application/json',
      },
    });

    if (response.status !== 200) {
      this.logger.error('unable to create document', {
        ...metadata,
        status: response.status,
        error: await response.text(),
      });
      throw new Error('unable to create document');
    }

    const result = await response.json();

    // Insert job entry into db. This is done here so we do not create a race
    // condition between the document being uploaded/unzipped and the docx
    // upload job being inserted
    await insertDocxUploadJobEntry(macroDB, {
      jobId,
      jobType,
      documentId: result.data.documentMetadata.documentId,
    });

    const url = result.data.presignedUrl;

    const uploadResponse = await fetch(url, {
      method: 'PUT',
      body: buffer,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'x-amz-checksum-sha256': base64Sha,
      },
    });

    if (uploadResponse.status !== 200) {
      this.logger.error('unable to upload document to bucket', {
        ...metadata,
        status: uploadResponse.status,
        error: await uploadResponse.text(),
      });
      throw new Error('unable to upload document to bucket');
    }
    return result.data.documentMetadata;
  }

  async create_pdf_document({
    buffer,
    documentName,
    owner,
    documentFamilyId,
    branchedFromId,
    branchedFromVersionId,
  }: {
    buffer: Buffer;
    documentName: string;
    owner: string;
    documentFamilyId?: number;
    branchedFromId?: string;
    branchedFromVersionId?: number;
  }): Promise<PdfDocument> {
    this.logger.debug('create_pdf_document', { documentName, owner });
    const hash = createHash('sha256');
    hash.update(buffer);
    const sha = hash.digest('hex');

    // Encode sha as base64
    const base64Sha = Buffer.from(sha, 'hex').toString('base64');

    const response = await fetch(`${this.baseUrl}/internal/documents`, {
      method: 'POST',
      body: JSON.stringify({
        documentName,
        owner,
        fileType: 'pdf',
        sha,
        isShareable: false,
        documentFamilyId,
        branchedFromId,
        branchedFromVersionId,
      }),
      headers: {
        [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
        [MACRO_INTERNAL_USER_ID_HEADER_KEY]: owner,
        'Content-Type': 'application/json',
      },
    });

    if (response.status !== 200) {
      this.logger.error('unable to create document', {
        status: response.status,
        error: await response.text(),
      });
      throw new Error('unable to create document');
    }

    const result = await response.json();

    const url = result.data.presignedUrl;

    const uploadResponse = await fetch(url, {
      method: 'PUT',
      body: buffer,
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': base64Sha,
      },
    });

    if (uploadResponse.status !== 200) {
      this.logger.error('unable to upload document to bucket', {
        status: uploadResponse.status,
        error: await uploadResponse.text(),
      });
      throw new Error('unable to upload document to bucket');
    }
    return result.data.documentMetadata;
  }

  async save_pdf_document(
    buffer: Buffer,
    documentId: string
  ): Promise<PdfDocument> {
    this.logger.debug('save_pdf_document', { documentId });
    const hash = createHash('sha256');
    hash.update(buffer);
    const sha = hash.digest('hex');
    const base64Sha = Buffer.from(sha, 'hex').toString('base64');

    const response = await fetch(
      `${this.baseUrl}/internal/documents/${documentId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          sha,
        }),
        headers: {
          [MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY]: this.authKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status !== 200) {
      this.logger.error('unable to save document', {
        status: response.status,
        error: await response.text(),
      });
      throw new Error('unable to save document');
    }

    const result = await response.json();

    const url = result.data.presignedUrl;

    const uploadResponse = await fetch(url, {
      method: 'PUT',
      body: buffer,
      headers: {
        'Content-Type': 'application/pdf',
        'x-amz-checksum-sha256': base64Sha,
      },
    });

    if (uploadResponse.status !== 200) {
      this.logger.error('unable to upload document to bucket', {
        status: uploadResponse.status,
        error: await uploadResponse.text(),
      });
      throw new Error('unable to upload document to bucket');
    }
    return result.data.documentMetadata;
  }
}

let _documentStorageService: DocumentStorageService;

export function documentStorageService(
  baseUrl?: string,
  authKey?: string,
  logger?: Logger
): DocumentStorageService {
  if (!_documentStorageService) {
    if (!logger) {
      throw new Error(
        'Logger is required to instantiate DocumentStorageService'
      );
    }
    if (!baseUrl) {
      throw new Error(
        'baseUrl is required to instantiate DocumentStorageService'
      );
    }
    if (!authKey) {
      throw new Error(
        'authKey is required to instantiate DocumentStorageService'
      );
    }
    _documentStorageService = new DocumentStorageService(
      baseUrl,
      authKey,
      logger
    );
  }
  return _documentStorageService;
}
