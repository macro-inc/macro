// Served from /public so the URL is stable and can be preloaded from index.html.
const MARKDOWN_GOLDEN_URL = '/markdown-golden.1.bin';

let goldenPromise: Promise<Uint8Array> | null = null;

export async function getMarkdownGoldenBytes(): Promise<Uint8Array> {
  if (!goldenPromise) {
    goldenPromise = (async () => {
      try {
        const res = await fetch(MARKDOWN_GOLDEN_URL);
        if (!res.ok) {
          throw new Error(
            `failed to fetch markdown golden snapshot: ${res.status}`
          );
        }
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      } catch (err) {
        // Allow retry on transient failure
        goldenPromise = null;
        throw err;
      }
    })();
  }
  return goldenPromise;
}
