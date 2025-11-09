import { contentHash } from '@core/util/hash';
import {
  DocumentMetadata,
  PdfDocumentMetadata,
  makeDocumentKey
} from '@macro-inc/document-processing-job-types';
import { FileSystemError } from '../error';
import { getFileNameWithExtension } from '../stringUtils';
import {
  BaseFile,
  ConstructorArgs,
  DocumentStorageServiceHandle,
  FileFromManager,
  FileSource,
} from './base';

type OperationType = 'BASE' | 'OCR' | 'CONVERT' | 'SAVE' | 'ANNOTATE';
interface Operation {
  type: OperationType;
  documentKey: string;
  sha: string;
}
interface StandardOperation extends Operation {
  type: 'BASE';
}
interface OperationWithAnnotationHash extends Operation {
  type: 'ANNOTATE';
  annotationStorageHash: string;
}
interface OperationWithModificationHash extends Operation {
  type: 'SAVE';
  modificationHash: string;
}
type OperationHistoryItem =
  | StandardOperation
  | OperationWithAnnotationHash
  | OperationWithModificationHash;

const getHash = async (
  buffer: ArrayBuffer | Blob | Uint8Array<ArrayBuffer>
): Promise<string> => {
  if (buffer instanceof Blob) {
    return contentHash(await buffer.arrayBuffer());
  }

  return contentHash(buffer);
};

/**
 * Represents a file that is stored in the Macro proprietary Document Storage Service.
 * @todo Scope this out further as we determine the requirements for this service.
 */
export class IDocumentStorageServiceFile
  extends BaseFile<DocumentStorageServiceHandle>
  implements FileFromManager {
  readonly source: FileSource.DocumentStorageService;
  readonly _hash: string | Promise<string>;
  private _operationHistory: OperationHistoryItem[] = [];
  private _metadata: DocumentMetadata;
  // private _baseDocumentKey: string;
  private _latestSaveModificationHash: string | undefined; // latest modification hash (for a file saved to DSS)
  private _latestSaveAnnotationStorageHash: string | undefined; // latest annotation storage hash
  private _saveAttempts: number = 0;
  public name: string;

  constructor({
    handle,
    metadata,
    operations,
    fileName,
    latestSaveModificationHash,
    latestAnnotationStorageHash,
    ...rest
  }: ConstructorArgs<DocumentStorageServiceHandle> & {
    operations?: OperationHistoryItem[];
    metadata: { fileType: string };
  }) {
    // TODO: handle inconsistencies in the file name and metadata
    super({ handle, fileName, ...rest });

    // this._baseDocumentKey = handle.ref;
    this.name = getFileNameWithExtension(fileName, metadata.fileType);

    // TODO: remove DOCX support
    if (metadata.fileType === 'pdf') {
      // TODO: clean up how we handle adding SHA so there's less room for confusion
      const sha = operations
        ? operations[operations.length - 1].sha
        // @ts-ignore
        : metadata.sha;

      this._latestSaveModificationHash = latestSaveModificationHash;
      this._latestSaveAnnotationStorageHash = latestAnnotationStorageHash;

      this._operationHistory = operations ?? [];
      if (this._operationHistory.length === 0) {
        this._operationHistory.push({
          type: 'BASE',
          documentKey: handle.ref,
          sha,
        });
      }

      this._hash = sha;
    } else {
      this._hash = super.hash();
    }

    this.source = FileSource.DocumentStorageService;

    this._metadata = metadata;
  }

  async hash(): Promise<string> {
    return this._hash;
  }

  public getLatestOperation() {
    return this._operationHistory[this._operationHistory.length - 1];
  }

  public getLatestModificationHash() {
    return this._latestSaveModificationHash ?? null;
  }

  public setLatestModificationHash(modificationHash: string) {
    this._latestSaveModificationHash = modificationHash;
  }

  public getLatestAnnotationStorageHash() {
    return this._latestSaveAnnotationStorageHash ?? null;
  }

  public getSaveAttempts() {
    return this._saveAttempts;
  }

  public attemptSave() {
    this._saveAttempts++;
  }

  public setMetadata(metadata: DocumentMetadata) {
    this._metadata = metadata;
  }

  public getMetadata() {
    return this._metadata;
  }

  public renameFile(name: string) {
    const nameWithExtension = getFileNameWithExtension(
      name,
      this._metadata.fileType
    );
    this.name = nameWithExtension;
    this._metadata.documentName = name;
  }

  public _addOperation({
    buffer,
    handle,
    metadata,
    documentKey,
    type,
    sha,
    mimeType,
    modificationHash,
    annotationStorageHash,
  }: {
    buffer: ArrayBuffer | Blob | Uint8Array<ArrayBuffer>;
    handle?: DocumentStorageServiceHandle;
    documentKey: string;
    metadata?: DocumentMetadata;
    type: Exclude<OperationType, 'BASE'>;
    sha: string;
    mimeType?: string;
    modificationHash?: string;
    annotationStorageHash?: string;
  }) {
    let newOperation: OperationHistoryItem;
    switch (type) {
      case 'SAVE':
        if (!modificationHash) {
          throw new Error('modification hash must be provided');
        }
        newOperation = {
          documentKey,
          type,
          sha,
          modificationHash,
        };
        break;
      case 'ANNOTATE':
        if (!annotationStorageHash) {
          throw new Error('annotation hash must be provided');
        }
        newOperation = {
          documentKey,
          type,
          sha,
          annotationStorageHash,
        };
        break;
      default:
        throw new Error('not supported');
    }

    return new IDocumentStorageServiceFile({
      fileBits: [buffer],
      fileName: this.name,
      options: {
        type: mimeType ?? this.type,
        lastModified: Date.now(),
      },
      handle: handle ?? this.filehandle,
      // randName: this.randName,
      metadata: metadata ?? this._metadata,
      operations: [...this._operationHistory, newOperation],
      latestSaveModificationHash:
        modificationHash ?? this._latestSaveModificationHash,
      latestAnnotationStorageHash:
        annotationStorageHash ?? this._latestSaveAnnotationStorageHash,
    });
  }

  public async addAnnotateOperation({
    buffer,
    documentKey,
    sha,
    annotationStorageHash,
  }: {
    buffer: | ArrayBuffer | Blob | Uint8Array<ArrayBuffer>;
    documentKey: string;
    annotationStorageHash: string;
    sha?: string;
  }) {
    return this._addOperation({
      buffer,
      documentKey,
      type: 'ANNOTATE',
      sha: sha ?? (await getHash(buffer)),
      annotationStorageHash,
    });
  }

  public async addSaveOperation({
    metadata,
    modificationHash,
  }: {
    metadata: PdfDocumentMetadata;
    modificationHash: string;
  }) {
    const { owner, fileType, documentId, documentVersionId } = metadata;

    const handle = createDocumentStorageServiceHandle({
      owner,
      fileType,
      documentId,
      documentVersionId: documentVersionId.toString(),
    });

    return this._addOperation({
      buffer: await this.arrayBuffer(),
      documentKey: handle.ref,
      type: 'SAVE',
      handle,
      metadata,
      sha: metadata.sha,
      modificationHash,
    });
  }

  /**
   * @throws {FileSystemError} if the handle is invalid
   */
  public static validateDocumentStorageServiceHandle = (
    handle: DocumentStorageServiceHandle
  ): void => {
    // @lguti97 temporary solution while I figure out zod types
    const getLocalDocumentKeyParts = (
      documentKey: string,
    ): {
      owner: string;
      documentId: string;
      documentVersionId: string;
      fileType: string;
    } => {
      const [owner, documentId, fileName] = documentKey.split('/');
      const [documentVersionId, fileType] = fileName.split('.');

      return {
        owner,
        documentId,
        documentVersionId,
        fileType,
      };
    };

    try {
      getLocalDocumentKeyParts(handle.ref);
    } catch (e) {
      throw new FileSystemError(`Invalid document key: ${handle.ref}`);
    }
  };
}

export const createDocumentStorageServiceHandle = (
  ...args: Parameters<typeof makeDocumentKey>
): DocumentStorageServiceHandle => {
  const documentKey = makeDocumentKey(...args);
  return { source: FileSource.DocumentStorageService, ref: documentKey };
};

export const createHTMLDocumentStorageServiceHandle = (
  ...args: Parameters<typeof makeDocumentKey>
): DocumentStorageServiceHandle => {
  const documentKey = `${args[0].owner}/${args[0].documentId}/${args[0].documentVersionId}.${args[0].fileType}`;
  return { source: FileSource.DocumentStorageService, ref: documentKey };
};
