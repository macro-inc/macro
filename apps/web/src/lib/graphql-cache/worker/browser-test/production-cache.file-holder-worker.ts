/// <reference lib="webworker" />

/**
 * Keeps database files open without their owner Web Lock, standing in for a
 * page's cache worker that is still being torn down after the page left.
 */
export type FileHolderRequest =
  | { kind: 'hold'; paths: string[] }
  | { kind: 'release' };

export type FileHolderResponse =
  | { kind: 'holding' }
  | { kind: 'released' }
  | { kind: 'error'; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;
let handles: FileSystemSyncAccessHandle[] = [];

const isBusy = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'NoModificationAllowedError';

/** The terminated owner may still be letting go of the file. */
const openWhenFree = async (
  root: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemSyncAccessHandle> => {
  const file = await root.getFileHandle(path);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await file.createSyncAccessHandle();
    } catch (error) {
      if (!isBusy(error) || attempt >= 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
};

const handle = async (
  request: FileHolderRequest
): Promise<FileHolderResponse> => {
  if (request.kind === 'hold') {
    const root = await navigator.storage.getDirectory();
    for (const path of request.paths) {
      handles.push(await openWhenFree(root, path));
    }
    return { kind: 'holding' };
  }
  for (const held of handles) held.close();
  handles = [];
  return { kind: 'released' };
};

worker.onmessage = async (event: MessageEvent<FileHolderRequest>) => {
  let response: FileHolderResponse;
  try {
    response = await handle(event.data);
  } catch (error) {
    response = {
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  worker.postMessage(response);
};
