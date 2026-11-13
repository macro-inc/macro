import { buildStoredZip } from './stored-zip';

export type ZipWorkerRequest = {
  taskId: string;
  action: 'zipFiles';
  files: File[];
  /** Archive path of each file in `files`, in the same order. */
  fileDetails: { path: string }[];
  /** Folder paths to write as entries, so empty folders survive. */
  folderPaths?: string[];
};

export type ZipWorkerResponse =
  | {
      taskId: string;
      type: 'progress';
      data: { processedBytes: number; totalBytes: number };
    }
  | {
      taskId: string;
      type: 'complete';
      data: { zipBlob: Blob; sha256: string };
    }
  | { taskId: string; type: 'error'; data: { message: string } };

export type ZipWorkerPort = {
  postMessage(message: ZipWorkerResponse): void;
  onmessage: ((event: MessageEvent<ZipWorkerRequest>) => void) | null;
};

/** Reading progress is reported at most this often, not once per chunk. */
const PROGRESS_INTERVAL_MS = 100;

async function zipFiles(port: ZipWorkerPort, request: ZipWorkerRequest) {
  const { taskId, files, fileDetails, folderPaths } = request;
  let reportedAt = 0;

  const { blob, sha256 } = await buildStoredZip(
    files.map((file, index) => ({ file, path: fileDetails[index].path })),
    folderPaths ?? [],
    (processedBytes, totalBytes) => {
      const now = Date.now();
      if (now - reportedAt < PROGRESS_INTERVAL_MS) return;
      reportedAt = now;
      port.postMessage({
        taskId,
        type: 'progress',
        data: { processedBytes, totalBytes },
      });
    }
  );

  port.postMessage({
    taskId,
    type: 'complete',
    data: { zipBlob: blob, sha256 },
  });
}

async function handleRequest(port: ZipWorkerPort, request: ZipWorkerRequest) {
  try {
    await zipFiles(port, request);
  } catch (error) {
    port.postMessage({
      taskId: request.taskId,
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** Kept injectable so the worker can be tested without a real worker. */
export function installZipWorker(port: ZipWorkerPort): void {
  port.onmessage = ({ data: request }) => handleRequest(port, request);
}

// Worker entry point only: importing in a browser window does not install a handler.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  installZipWorker(self);
}
