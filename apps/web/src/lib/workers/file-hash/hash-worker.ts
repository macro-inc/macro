import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

export type HashWorkerRequest = { file: Blob };

export type HashWorkerResponse =
  | { type: 'complete'; sha256: string }
  | { type: 'error'; message: string };

export type HashWorkerPort = {
  postMessage(message: HashWorkerResponse): void;
  onmessage: ((event: MessageEvent<HashWorkerRequest>) => void) | null;
};

/** Bytes read at a time, which bounds the memory a hash takes. */
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

/** Hex SHA-256 of `blob`, read in chunks so it is never held whole. */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  const hash = sha256.create();
  for (let start = 0; start < blob.size; start += READ_CHUNK_BYTES) {
    const chunk = await blob
      .slice(start, start + READ_CHUNK_BYTES)
      .arrayBuffer();
    hash.update(new Uint8Array(chunk));
  }
  return bytesToHex(hash.digest());
}

async function handleRequest(port: HashWorkerPort, request: HashWorkerRequest) {
  try {
    port.postMessage({
      type: 'complete',
      sha256: await sha256OfBlob(request.file),
    });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Kept injectable so the worker can be tested without a real worker. */
export function installHashWorker(port: HashWorkerPort): void {
  port.onmessage = ({ data: request }) => handleRequest(port, request);
}

// Worker entry point only: importing in a browser window does not install a handler.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  installHashWorker(self);
}
