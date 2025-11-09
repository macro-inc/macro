import type { DocxExpandedPartList } from './getDocxFile';

/** If making breaking changes to the OPFS structure / format, increment this */
const OPFS_VERSION = 0;

export const OPFS_DIR_NAME = `macro-documents-v${OPFS_VERSION}`;

let opfsHandle_: FileSystemDirectoryHandle | null = null;
/** OPFS filesystem handle singleton */
async function getOPFSHandle() {
  if (!opfsHandle_) {
    opfsHandle_ = await navigator.storage.getDirectory();
  }
  return opfsHandle_;
}

let opfsDocumentDirHandle_: FileSystemDirectoryHandle | null = null;

async function getOPFSDocumentDirHandle() {
  if (!opfsDocumentDirHandle_) {
    const opfsHandle = await getOPFSHandle();
    opfsDocumentDirHandle_ = await opfsHandle.getDirectoryHandle(
      OPFS_DIR_NAME,
      {
        create: true,
      }
    );
  }
  return opfsDocumentDirHandle_;
}

export interface OPFSDocumentStore {
  get: (
    documentID: string,
    options?: { create: boolean }
  ) => Promise<
    { exists: true; document: OPFSDocument } | { exists: false; document: null }
  >;
  remove: (documentID: string) => Promise<void>;
}

/** Abstraction around a Macro DSS Document that exists in OPFS */
export class OPFSDocument {
  private readonly opfsDocumentDirHandle: FileSystemDirectoryHandle;
  readonly documentID: string;

  constructor(
    documentID: string,
    opfsDocumentDirHandle: FileSystemDirectoryHandle
  ) {
    this.documentID = documentID;
    this.opfsDocumentDirHandle = opfsDocumentDirHandle;
  }

  /** Get a bom part of the document using the sha nad path
   * Both path and sha are required, since it is possible for multiple parts
   * to have the same sha.
   */
  async getPart(
    path: string,
    sha: string
  ): Promise<
    { exists: true; buffer: ArrayBuffer } | { exists: false; buffer: null }
  > {
    const fullPath = `${encodeURIComponent(path)}@${sha}`;
    let fileHandle: FileSystemFileHandle | null = null;
    try {
      fileHandle = await this?.opfsDocumentDirHandle.getFileHandle(fullPath, {
        create: false,
      });
    } catch {
      return { exists: false, buffer: null };
    }

    if (!fileHandle) return { exists: false, buffer: null };

    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return { exists: true, buffer: arrayBuffer };
  }

  /** Remove a bom part of the document */
  async removePart(path: string, sha: string): Promise<void> {
    const fullPath = `${encodeURIComponent(path)}@${sha}`;
    await this?.opfsDocumentDirHandle.removeEntry(fullPath);
  }

  /** Add a bom part of the document*/
  async addPart(
    path: string,
    sha: string,
    buffer: FileSystemWriteChunkType
  ): Promise<void> {
    const fullPath = `${encodeURIComponent(path)}@${sha}`;
    const fileHandle = await this?.opfsDocumentDirHandle.getFileHandle(
      fullPath,
      { create: true }
    );
    const writable = await fileHandle.createWritable({
      keepExistingData: false,
    });
    try {
      await writable.write(buffer);
    } catch (err) {
      console.error('failed to write to file', err);
      return;
    }
    await writable.close();
  }

  /** List all the parts of the document */
  async list(): Promise<DocxExpandedPartList> {
    // @ts-ignore .values() _is_ part of the standard since early 2023
    const entries = this.opfsDocumentDirHandle.values();
    const result: DocxExpandedPartList = [];
    for await (const entry of entries) {
      const [path, sha] = entry.name.split('@');
      result.push({ path: decodeURIComponent(path), sha });
    }
    return result;
  }
}

async function _getFromStore(
  documentID: string,
  options?: { create: boolean }
): Promise<
  { exists: false; document: null } | { exists: true; document: OPFSDocument }
> {
  const opfsDocumentDirHandle = await getOPFSDocumentDirHandle();
  try {
    const dirHandle = await opfsDocumentDirHandle.getDirectoryHandle(
      documentID,
      { create: options?.create ?? false }
    );
    return { exists: true, document: new OPFSDocument(documentID, dirHandle) };
  } catch (err) {
    console.error('failed to get document handle from store', err);
    return { exists: false, document: null };
  }
}
async function _removeFromStore(documentID: string): Promise<void> {
  const opfsDocumentDirHandle = await getOPFSDocumentDirHandle();
  await opfsDocumentDirHandle.removeEntry(documentID);
}

export async function getOPFSDocumentStore(): Promise<OPFSDocumentStore> {
  return {
    get: _getFromStore,
    remove: _removeFromStore,
  };
}
