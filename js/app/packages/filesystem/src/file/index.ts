import {
  ConstructorArgs,
  DocumentStorageServiceHandle,
  FileHandle,
  FileSource,
} from './base';

import { FileSystemError, NotImplementedError } from '../error';
import { EphemeralFile } from './ephemeral';

import {
  IDocumentStorageServiceFile,
  createDocumentStorageServiceHandle,
} from './documentStorageService';
import { DocumentKeyParts } from '../types/documentKey';
import { fileExtension, filenameWithoutExtension } from '@service-storage/util/filename';

// re-export required types, note that internal file classes are exported as types only
// the constuctors are considered private and are accessed through the unified makeFile fn
export type {
  FileHandle,
  EphemeralFile,
  IDocumentStorageServiceFile,
};
export { FileSource };

export type { DocumentKeyParts };

export type FileSystemFile = IDocumentStorageServiceFile;

export { createDocumentStorageServiceHandle };

// conditional typing to have strong return types
type FileReturn<T extends FileHandle | undefined> = T extends undefined
  ? EphemeralFile
  : FileSystemFile;

/*
 * Throws filesystem error if the file handle is invalid at runtime
 */
function _validateFileHandle(handle: FileHandle) {
  switch (handle.source) {
    case FileSource.Path: {
      if (!handle.ref) {
        throw new FileSystemError(
          `Received PathHandle but path is invalid, expected OS path but received: ${handle.ref}`
        );
      }
      return;
    }
    case FileSource.Browser: {
      if (!handle.ref?.getFile || !handle.ref?.createWritable) {
        throw new FileSystemError(
          `Expected FileSystemFileHandle, received object without getFile or createWritable methods: ${handle.ref}`
        );
      }
      return;
    }
    case FileSource.DocumentStorageService: {
      IDocumentStorageServiceFile.validateDocumentStorageServiceHandle(handle);
      return;
    }
  }
}

/*
 * Truncates the filename to 255 characters if it is longer than 255 characters
 */
function truncateFileName(name: string) {
  try {
    const fileExtension_ = fileExtension(name) ?? '';
    let fileName = filenameWithoutExtension(name) ?? '';
    if (fileName.length > 255 - (fileExtension_.length + 1)) {
      // truncate the filename to 255 characters including the extension leave 10 character buffer just in case
      fileName = fileName.substring(0, 255 - (fileExtension_.length + 1) - 10);
    }
    if (fileExtension_.length > 0) {
      fileName = fileName + '.' + fileExtension_;
    }
    return fileName;
  } catch (e) {
    // no extension
    if (name.length > 255) {
      return name.substring(0, 255);
    }

    return name;
  }
}

/*
 * Uses an existing handle to return a new instance of HandledFile
 */
export async function makeFile<T extends FileHandle | undefined>({
  handle,
  ...args
}: ConstructorArgs<T>): Promise<FileReturn<T>> {
  const fileName = truncateFileName(args.fileName);

  if (!handle) {
    return new EphemeralFile({
      handle,
      ...args,
      fileName,
    }) as FileReturn<T>;
  }

  // throw if handle is invalid
  _validateFileHandle(handle);

  switch (handle.source) {
    case FileSource.DocumentStorageService: {
      return new IDocumentStorageServiceFile({
        ...(args as Omit<
          ConstructorArgs<DocumentStorageServiceHandle>,
          'handle'
        >),
        handle,
        fileName,
      }) as FileReturn<T>;
    }
    default: {
      throw new NotImplementedError('This function is not implemented');
    }
  }
}
