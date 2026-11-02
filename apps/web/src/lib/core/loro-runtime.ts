import wasmUrl from 'loro-crdt/bundler/loro_wasm_bg.wasm?url';

let resourceHint: HTMLLinkElement | undefined;

/** Prepare the existing runtime without creating documents or editor instances. */
export function prepareLoro() {
  // The bundler glue fetches WASM only after its JS evaluates. Start the same
  // asset transfer at admission; matching fetch credentials let the browser
  // reuse it when the existing runtime streams/compiles its singleton.
  if (typeof document !== 'undefined' && !resourceHint) {
    resourceHint = document.createElement('link');
    resourceHint.rel = 'preload';
    resourceHint.as = 'fetch';
    resourceHint.type = 'application/wasm';
    resourceHint.crossOrigin = 'anonymous';
    resourceHint.href = wasmUrl;
    document.head.append(resourceHint);
  }
  return import('loro-crdt');
}
