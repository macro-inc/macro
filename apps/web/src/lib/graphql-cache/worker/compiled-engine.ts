/**
 * Hands the cache engine's compiled WebAssembly from one engine worker to the
 * next. Each tab return starts a new worker; the browser compiles the engine's
 * functions lazily in every one, which took longer than reopening the
 * database. A module the owner page still holds arrives already compiled.
 *
 * The page and the worker exchange it on a port of their own, so a browser
 * that cannot pass a module only loses the shortcut: activation and the
 * worker's error handlers never see it.
 */

/** A compiled engine and the asset it was compiled from. */
export type CompiledEngine = { assetUrl: string; module: WebAssembly.Module };

export type CompiledEngineExchange = {
  /** What the page still holds, if anything. Settles once, never rejects. */
  offered: Promise<CompiledEngine | undefined>;
  report(compiled: CompiledEngine): void;
};

type ExchangePort = Pick<MessagePort, 'postMessage'> & {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
};

function isCompiledEngine(value: unknown): value is CompiledEngine {
  return (
    typeof value === 'object' &&
    value !== null &&
    'assetUrl' in value &&
    typeof value.assetUrl === 'string' &&
    'module' in value &&
    value.module instanceof WebAssembly.Module
  );
}

// Kept for the life of the page, through hidden stretches too: the next
// engine worker is the one that needs it. A new build loads a new page.
let retained: CompiledEngine | undefined;

/** Page side: offers the retained engine once, then keeps what is reported. */
export function offerCompiledEngine(port: ExchangePort): void {
  port.onmessage = (event) => {
    if (isCompiledEngine(event.data)) retained = event.data;
  };
  port.onmessageerror = null;
  try {
    port.postMessage(retained ?? null);
  } catch {
    retained = undefined;
    port.postMessage(null);
  }
}

/** Worker side: the page's offer, and where to report a fresh compile. */
export function compiledEngineFromPage(
  port: ExchangePort
): CompiledEngineExchange {
  const offered = new Promise<CompiledEngine | undefined>((resolve) => {
    port.onmessage = (event) => {
      resolve(isCompiledEngine(event.data) ? event.data : undefined);
    };
    port.onmessageerror = () => resolve(undefined);
  });

  return {
    offered,
    report: (compiled) => {
      try {
        port.postMessage(compiled);
      } catch {
        // The page then compiles again next time, as it always did.
      }
    },
  };
}

/** Test seam: forget what an earlier case retained. */
export function forgetCompiledEngine(): void {
  retained = undefined;
}
