import type { DocxEditorExports } from 'docxodus';

type DocxodusModule = typeof import('docxodus');

export type DocxodusRuntime = {
  module: DocxodusModule;
  /** Raw engine exports, shared by every editor on the page. */
  exports: ReturnType<DocxodusModule['getWasmExports']>;
};

let loading: Promise<DocxodusRuntime> | undefined;

/** Where the build serves the runtime (see `scripts/docxodus-runtime.ts`). */
export function docxodusRuntimeBase(): string {
  const version = import.meta.env.DOCXODUS_VERSION;
  if (!version) throw new Error('This build does not serve the DOCX engine.');
  return `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}docxodus/${version}/`;
}

/**
 * Load the Docxodus editor and its WebAssembly engine once per page.
 * Assemblies stream in and compile off the main thread; nothing is fetched
 * until a DOCX is opened.
 */
export function loadDocxodus(): Promise<DocxodusRuntime> {
  loading ??= (async () => {
    const module = await import('docxodus');
    await module.initialize(docxodusRuntimeBase());
    return { module, exports: module.getWasmExports() };
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export type { DocxEditorExports };
