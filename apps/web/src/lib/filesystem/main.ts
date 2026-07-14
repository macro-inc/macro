export { openFromDisk } from './open';

export { UserError, FileSystemError, AlreadyCheckedOutError } from './error';
export {
  type FileHandle,
  FileSource,
  type FileSystemFile,
  makeFile,
  createDocumentStorageServiceHandle,
} from './file';

export { replaceExtension } from './stringUtils';

export { getOPFSDocumentStore } from './opfs';
export type { OPFSDocumentStore, OPFSDocument } from './opfs';
