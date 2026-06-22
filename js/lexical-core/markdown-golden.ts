let goldenPromise: Promise<Uint8Array> | null = null;

export async function getMarkdownGoldenBytes(): Promise<Uint8Array> {
  if (!goldenPromise) {
    goldenPromise = (async () => {
      try {
        const { MARKDOWN_GOLDEN } = await import('./markdown-golden.1');
        return MARKDOWN_GOLDEN;
      } catch (err) {
        // Allow retry on transient failure
        goldenPromise = null;
        throw err;
      }
    })();
  }
  const golden = await goldenPromise;
  return golden.slice();
}
