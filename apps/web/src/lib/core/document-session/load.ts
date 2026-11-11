import type { Span } from '@macro-inc/observability';

export type DocumentSessionModule =
  typeof import('@macro-inc/collaboration/session/wasm');
let pending: Promise<DocumentSessionModule> | undefined;
/** Main-thread initialization shared by editors; a failed offline fetch may retry. */
export function loadDocumentSession(
  span?: Span
): Promise<DocumentSessionModule> {
  pending ??= (async () => {
    try {
      const moduleUrl = new URL(
        './wasm/document_session_wasm.js',
        import.meta.url
      ).href;
      const binary = new URL(
        './wasm/document_session_wasm_bg.wasm',
        import.meta.url
      );
      const start = performance.now();
      // Fetch the binary while the glue loads; wasm-bindgen instantiates the
      // Response with streaming compilation rather than buffering the module.
      const [module, response]: [DocumentSessionModule, Response] =
        await Promise.all([
          import(/* @vite-ignore */ moduleUrl),
          fetch(binary),
        ]);
      await module.default({ module_or_path: response });
      span?.setAttr('instantiate_ms', performance.now() - start);
      return module;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  })();
  return pending;
}
