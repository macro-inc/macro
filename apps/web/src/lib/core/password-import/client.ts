/**
 * Parses an export file in a dedicated worker (Rust compiled to wasm). The
 * worker is created on the call, never at module load (iOS deadlocks on eager
 * module workers), and terminated after it answers.
 */
import type { ParseReply } from './types';

export async function parseExportFile(file: File): Promise<ParseReply> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(
    new URL('./password-import.worker.ts', import.meta.url),
    { type: 'module' }
  );
  try {
    return await new Promise<ParseReply>((resolve) => {
      worker.onmessage = (event: MessageEvent<ParseReply>) =>
        resolve(event.data);
      worker.onerror = () => resolve({ outcome: 'unreadable' });
      worker.onmessageerror = () => resolve({ outcome: 'unreadable' });
      // Transferred: the main thread keeps no copy of the file's bytes.
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
