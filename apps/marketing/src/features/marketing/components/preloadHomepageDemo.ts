type Preload = () => Promise<unknown>;
const queue: { load: Preload; cancelled: boolean }[] = [];
let draining = false;

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      setTimeout(resolve, 250);
    }
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    if (document.readyState !== 'complete') {
      await new Promise<void>((resolve) =>
        window.addEventListener('load', () => resolve(), { once: true })
      );
    }
    while (queue.length) {
      await idle();
      const next = queue.shift()!;
      if (next.cancelled) continue;
      try {
        // One import at a time: warm the code without mounting editors or
        // starting their demo animations while the reader is elsewhere.
        await next.load();
      } catch {
        // Speculative loading is optional; the visible demo handles load errors.
      }
    }
  } finally {
    draining = false;
  }
}

/** Warm demos after page load and between idle opportunities. */
export function preloadHomepageDemo(load: Preload): () => void {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? ''))
    return () => {};

  const entry = { load, cancelled: false };
  queue.push(entry);
  void drain();
  return () => {
    entry.cancelled = true;
  };
}
