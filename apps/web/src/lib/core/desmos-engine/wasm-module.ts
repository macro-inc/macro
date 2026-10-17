/**
 * Typed surface of the generated wasm package (`desmos_engine`).
 * Build with `just build-desmos-engine-wasm`.
 *
 * The generated package under `./wasm/` is gitignored (same as pptx/docx/fig).
 * Typecheck must not resolve a static `./wasm/desmos_engine.js` import, so load
 * via `@vite-ignore` + `import.meta.url` like the other engines.
 */

export interface WasmDesmosGraph {
  to_json: () => string;
  plot: () => string;
  setLatex: (id: string, latex: string) => void;
  setColor: (id: string, color: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  addExpression: () => string;
  remove: (id: string) => void;
  setViewport: (xmin: number, xmax: number, ymin: number, ymax: number) => void;
  setSlider: (id: string, value: number) => void;
  addSlider: (name: string) => string;
  free: () => void;
}

interface DesmosEngineWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  DesmosGraph: {
    new (json: string): WasmDesmosGraph;
    blankJson: () => string;
  };
}

let modulePromise: Promise<DesmosEngineWasmModule> | undefined;

export function loadDesmosEngineWasm(): Promise<DesmosEngineWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const base = new URL('./wasm/desmos_engine.js', import.meta.url);
        const mod = (await import(
          /* @vite-ignore */ base.href
        )) as DesmosEngineWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL(
          './wasm/desmos_engine_bg.wasm',
          import.meta.url
        );
        await mod.default({ module_or_path: wasmUrl });
        return mod;
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}
