import { FileSystemError, UserError } from './error';
import { FileSystemFile, FileHandle, FileSource } from './file';
import {
  browserFileFilter,
  FileFilter,
  filterFromExt,
} from './fileFilter';
import { readFileFromHandle } from './read';



async function openInBrowser(
  filters: Array<FileFilter>,
  multiple: boolean
): Promise<FileHandle[]> {
  const openFilePicker = window?.showOpenFilePicker;
  if (!openFilePicker) {
    throw new FileSystemError(
      `Detected a support browser file system environment but showOpenFilePicker is: ${openFilePicker}`
    );
  }

  const browserOptions = browserFileFilter({ filters });
  let fsHandles: Array<FileSystemFileHandle> | null = null;
  try {
    fsHandles = await openFilePicker({ ...browserOptions, multiple });
  } catch (err) {
    throw new UserError(`User aborted the operation: ${err}`);
  }

  if (!fsHandles || !fsHandles.length) {
    throw new FileSystemError(
      `No filesystem handle was returned from browser api, expected non-empty array of FileSystemFileHandle, received: ${fsHandles}`
    );
  }

  return fsHandles.map((handle) => ({
    source: FileSource.Browser,
    ref: handle,
  }));
}

/**
 * Returns a FileHandle referencing a file the user wishes to open
 * handle should be used to lookup data from cache or "readFromHandle"
 * e.g.
 * ```typescript
 *  const handle = await openFromDisk([{ ext: "pdf", mime: "application/pdf", name: "PDF File" }])
 *  const file = await readFromHandle(handle)
 *  const cacheDb = await getDocumentCache()
 *  const cachedData = await cacheDb.getByHandle(handle)
 * ```
 */
export async function openFromDisk({
  exts,
  multiple = false,
  readonly = false,
}: {
  exts: Array<string>;
  multiple: boolean;
  readonly?: boolean;
}): Promise<Array<{ file: FileSystemFile }>> {
  const filters = exts.map(filterFromExt);

  const handles = await openInBrowser(filters, multiple);

  const files = await Promise.all(
    handles.map((handle) => readFileFromHandle({ handle, readonly }))
  );
  return files.map((file) => ({ file }));
}
