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
// A compile the page started before any engine worker existed, so that the
// first one finds the engine compiled. Never rejects.
let prefetched: Promise<CompiledEngine | undefined> | undefined;

/**
 * Page side: compiles the engine ahead of the first engine worker, while the
 * page is still waiting to learn whether it owns the cache. Does nothing when
 * the page already holds one.
 */
export function prefetchCompiledEngine(
  compile: () => Promise<CompiledEngine>
): void {
  if (retained || prefetched) return;
  prefetched = compile().catch(() => undefined);
}

/**
 * Page side: forgets a compile no engine worker took, once another page runs
 * the engine. The compiled code is then only memory this page holds.
 */
export function dropPrefetchedCompiledEngine(): void {
  prefetched = undefined;
}

function post(port: ExchangePort, engine: CompiledEngine | undefined): void {
  try {
    port.postMessage(engine ?? null);
  } catch {
    retained = undefined;
    try {
      port.postMessage(null);
    } catch {
      // The worker is already gone; its loss is reported elsewhere.
    }
  }
}

/**
 * Page side: offers the retained engine once, or the one still compiling
 * ahead of the worker, then keeps what is reported.
 */
export function offerCompiledEngine(port: ExchangePort): void {
  port.onmessage = (event) => {
    // The worker answers `null` when it could not receive what was offered.
    retained = isCompiledEngine(event.data) ? event.data : undefined;
  };
  port.onmessageerror = null;
  const pending = retained ? undefined : prefetched;
  prefetched = undefined;
  if (pending) {
    // `pending` never rejects: a failed compile ahead resolves to nothing.
    pending
      .then((engine) => {
        // Kept like a compile the worker reports, for the worker that starts
        // when the tab returns; a worker that cannot receive it answers `null`.
        retained ??= engine;
        post(port, engine);
      })
      .catch(() => undefined);
  } else post(port, retained);
}

/** Worker side: the page's offer, and where to report a fresh compile. */
export function compiledEngineFromPage(
  port: ExchangePort
): CompiledEngineExchange {
  const offered = new Promise<CompiledEngine | undefined>((resolve) => {
    port.onmessage = (event) => {
      resolve(isCompiledEngine(event.data) ? event.data : undefined);
    };
    port.onmessageerror = () => {
      resolve(undefined);
      // Tell the page to stop offering a module this worker cannot receive.
      try {
        port.postMessage(null);
      } catch {
        // It offers again next time and this worker loads normally anyway.
      }
    };
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
  prefetched = undefined;
}
