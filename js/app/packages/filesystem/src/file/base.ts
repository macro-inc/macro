import { blockAcceptedMimetypeToFileExtension } from '@core/constant/allBlocks';
import type { DocumentMetadata } from '@macro-inc/document-processing-job-types';
import { fileExtension } from '@service-storage/util/filename';
import { contentHash } from '../../../core/util/hash';

export enum FileSource {
  Path = 'OPERATING_SYSTEM_PATH',
  Browser = 'BROWSER_FS_ACCESS',
  DocumentStorageService = 'DOCUMENT_STORAGE_SERVICE',
}

type DiskSource = FileSource.Path | FileSource.Browser;
type ManagerSource = FileSource.DocumentStorageService;

export interface FileFromDisk extends File {
  source: DiskSource;
  filehandle: FileHandle;
}

export interface FileFromManager extends File {
  source: ManagerSource;
  filehandle: FileHandle;
}

/** typed as any since it has not been implemented yet */
export type PathHandle = { source: FileSource.Path; ref: string };
export type BrowserHandle = {
  source: FileSource.Browser;
  ref: FileSystemFileHandle;
};
export type DocumentStorageServiceHandle = {
  source: FileSource.DocumentStorageService;
  ref: string;
};

export type FileHandle =
  | PathHandle
  | BrowserHandle
  | DocumentStorageServiceHandle;

interface FileOptions {
  type: string;
  lastModified: number;
}

type BaseConstructorArgs<T extends FileHandle | undefined> = {
  fileBits: BlobPart[];
  fileName: string;
  options: FileOptions;
  handle: T;
  /** What is the application temp name if it exists */
  randName?: string;
  disableEphemeral?: boolean; // disable ephemeral file creation in makeFile if temp path
};

export type ConstructorArgs<T extends FileHandle | undefined> =
  T extends DocumentStorageServiceHandle
    ? BaseConstructorArgs<T> & {
        metadata: DocumentMetadata;
        latestSaveModificationHash?: string;
        latestAnnotationStorageHash?: string;
      }
    : BaseConstructorArgs<T>;

function genRandHex(len: number): string {
  const arr = window.crypto.getRandomValues(new Uint8Array(len));
  return arr.reduce((acc, cur) => acc + ('0' + cur.toString(16)).slice(-2), '');
}

/*
 * Extends the base File type to make the file properties a mandatory argument
 * Used to have stronger typing on file metadata
 */
export abstract class BaseFile<T extends FileHandle | undefined> extends File {
  private _handle: T;
  private _type: string;
  private _writable: boolean;
  private _ext: string;
  public readonly randName: string;

  public get writable() {
    return this._writable;
  }

  public get type() {
    return this._type;
  }

  public get filehandle() {
    return this._handle;
  }

  constructor({
    fileBits,
    fileName,
    options,
    handle,
    randName,
  }: BaseConstructorArgs<T>) {
    const validMime = options.type;
    super(fileBits, fileName, {
      lastModified: options.lastModified,
      type: validMime,
    });
    this._type = validMime;
    this._handle = handle;
    this._writable = true;
    // This is lossy, we have this information before using this silly makeFile stuff, really need to get rid of it
    this._ext =
      fileExtension(this.name) ??
      blockAcceptedMimetypeToFileExtension[validMime];

    const ext = this.ext;
    this.randName = randName ?? `${genRandHex(4)}.${ext}`;
  }

  public async release() {
    this._writable = false;
  }

  public get ext(): string {
    return this._ext;
  }

  public get nameWithoutExt(): string {
    try {
      const trimLength = this.name.length - this.ext.length - 1;
      return this.name.substring(0, trimLength);
    } catch (e) {
      return this.name;
    }
  }

  async hash(): Promise<string> {
    return await contentHash(await this.arrayBuffer());
  }
}
