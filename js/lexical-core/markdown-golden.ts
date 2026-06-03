import MARKDOWN_GOLDEN_URL from './markdown-golden.1.bin?url';

let goldenPromise: Promise<Uint8Array> | null = null;

export function getMarkdownGoldenBytes(): Promise<Uint8Array> {
  if (!goldenPromise) {
    goldenPromise = fetch(MARKDOWN_GOLDEN_URL)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            `failed to fetch markdown golden snapshot: ${res.status}`
          );
        }
        return res.arrayBuffer();
      })
      .then((buf) => new Uint8Array(buf))
      .catch((err) => {
        // Allow retry on transient failure
        goldenPromise = null;
        throw err;
      });
  }
  return goldenPromise;
}
