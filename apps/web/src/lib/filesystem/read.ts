import { blockAcceptedFileExtensionToMimeType } from '@core/constant/allBlocks';
import { fileExtension } from '@service-storage/util/filename';
import { NotImplementedError } from './error';
import {
  type FileHandle,
  FileSource,
  type FileSystemFile,
  type IDocumentStorageServiceFile,
  makeFile,
} from './file';
import { verifyHandlePermission } from './getPermission';

export async function readFileFromHandle({
  handle,
}: {
  handle: FileHandle;
  readonly: boolean;
}): Promise<FileSystemFile> {
  switch (handle.source) {
    case FileSource.Browser: {
      return await _readFromBrowserHandle(handle);
    }
    case FileSource.DocumentStorageService: {
      return await _readFromDocumentStorageServiceHandle(handle);
    }

    default: {
      throw new NotImplementedError(
        `Tried to open a file handle type which doesnt have an implementation: ${handle.source}`
      );
    }
  }
}

async function _readFromBrowserHandle(handle: {
  source: FileSource.Browser;
  ref: FileSystemFileHandle;
}): Promise<FileSystemFile> {
  const validHandle = await verifyHandlePermission(handle.ref, 'read');

  const plainFile = await validHandle.getFile();
  const ab = await plainFile.arrayBuffer();
  const ext = fileExtension(handle.ref.name)!;

  const mimeType = blockAcceptedFileExtensionToMimeType[ext];

  return await makeFile({
    fileBits: [ab],
    fileName: plainFile.name,
    handle,
    options: {
      type: mimeType,
      lastModified: plainFile.lastModified,
    },
  });
}

async function _readFromDocumentStorageServiceHandle(_handle: {
  source: FileSource.DocumentStorageService;
  ref: string;
}): Promise<IDocumentStorageServiceFile> {
  throw new NotImplementedError('DSS read from file handle not implemented');
}
