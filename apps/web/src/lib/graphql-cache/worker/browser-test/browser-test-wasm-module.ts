type BrowserTestCacheWasmModule = {
  default(input?: { module_or_path?: unknown }): Promise<unknown>;
  browserTestMakeNamespaceIncompatible(scope: string): Promise<void>;
  browserTestCorruptQueuePayload(scope: string): Promise<void>;
};

let modulePromise:
  | Promise<{ module: BrowserTestCacheWasmModule; wasmUrl: string }>
  | undefined;

/** Loads the separate feature-gated destructive-hook artifact for tests only. */
export function loadBrowserTestCacheWasm(): Promise<{
  module: BrowserTestCacheWasmModule;
  wasmUrl: string;
}> {
  if (modulePromise) return modulePromise;
  const initialization = (async () => {
    const glueUrl = new URL(
      '../../wasm-browser-test/cache_wasm_browser_test_hooks.js',
      import.meta.url
    ).href;
    const wasmUrl = new URL(
      '../../wasm-browser-test/cache_wasm_browser_test_hooks_bg.wasm',
      import.meta.url
    ).href;
    const module = (await import(
      /* @vite-ignore */ glueUrl
    )) as BrowserTestCacheWasmModule;
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`browser-test WASM returned HTTP ${response.status}`);
    }
    const compiled = await WebAssembly.compile(await response.arrayBuffer());
    await module.default({ module_or_path: compiled });
    return { module, wasmUrl };
  })();
  modulePromise = initialization;
  void initialization.catch(() => {
    if (modulePromise === initialization) modulePromise = undefined;
  });
  return initialization;
}
