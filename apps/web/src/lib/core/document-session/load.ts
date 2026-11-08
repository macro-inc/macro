import { Telemetry } from '@macro-inc/observability';

type SessionModule = typeof import('@macro-inc/collaboration/session/wasm');
let pending: Promise<SessionModule> | undefined;
/** Main-thread initialization shared by editors; a failed offline fetch may retry. */
export function loadDocumentSession(): Promise<SessionModule> {
  pending ??= Telemetry.span('wasm.init', async (span) => {
    try {
      const moduleUrl = new URL(
        './wasm/document_session_wasm.js',
        import.meta.url
      ).href;
      const module: SessionModule = await import(/* @vite-ignore */ moduleUrl);
      const binary = new URL(
        './wasm/document_session_wasm_bg.wasm',
        import.meta.url
      );
      const start = performance.now();
      await module.default({ module_or_path: binary });
      span.setAttr('instantiate_ms', performance.now() - start);
      return module;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  });
  return pending;
}
