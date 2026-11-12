/// <reference lib="webworker" />

/**
 * Parses one password-manager export off the main thread. The client starts
 * a worker per file and terminates it after the reply, which frees the wasm
 * memory that held the file and its values.
 */
import type { ParseReply } from './types';
import { loadPasswordImportWasm } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function parse(buffer: ArrayBuffer): Promise<ParseReply> {
  try {
    const wasm = await loadPasswordImportWasm();
    const bytes = new Uint8Array(buffer);
    const detected = wasm.detect(bytes);
    if (detected.outcome === 'failed') return detected;
    return wasm.parse(bytes, detected.format);
  } catch {
    // Never forward the error: it could quote the file.
    return { outcome: 'unreadable' };
  }
}

// `parse` never rejects, so the handler always answers.
scope.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  scope.postMessage(await parse(event.data));
};
