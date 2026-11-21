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
 * How long an engine worker waits for the page's compile ahead before it
 * downloads and compiles the engine itself. The compile ahead started first,
 * so it is normally the sooner one; this only bounds a download that stalls.
 */
export const PREFETCH_OFFER_WAIT_MS = 10_000;

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
 * the engine or this page leaves the coordinator. The compiled code would
 * only be memory this page holds; a page elected later compiles again.
 */
export function dropPrefetchedCompiledEngine(): void {
  prefetched = undefined;
}

function post(port: ExchangePort, engine: CompiledEngine | undefined): void {
  try {
    port.postMessage(engine ?? null);
  } catch {
    // Only what this port failed to carry; another exchange may have
    // retained a newer module meanwhile.
    if (retained === engine) retained = undefined;
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
export function offerCompiledEngine(
  port: ExchangePort,
  waitMs: number = PREFETCH_OFFER_WAIT_MS
): void {
  port.onmessage = (event) => {
    // The worker answers `null` when it could not receive what was offered.
    retained = isCompiledEngine(event.data) ? event.data : undefined;
  };
  port.onmessageerror = null;
  const pending = retained ? undefined : prefetched;
  prefetched = undefined;
  if (!pending) {
    post(port, retained);
    return;
  }
  let offered = false;
  const offer = (engine: CompiledEngine | undefined): void => {
    if (offered) return;
    offered = true;
    post(port, engine);
  };
  // A stalled compile ahead must not hold the worker: it compiles itself.
  const timer = setTimeout(() => offer(undefined), waitMs);
  // `pending` never rejects: a failed compile ahead resolves to nothing.
  pending
    .then((engine) => {
      clearTimeout(timer);
      // Kept like a compile the worker reports, for the worker that starts
      // when the tab returns; a worker that cannot receive it answers `null`.
      // One that finished after the worker stopped waiting is kept the same.
      retained ??= engine;
      offer(engine);
    })
    .catch(() => undefined);
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
