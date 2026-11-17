export function markdownToLoroSnapshot(
  markdown: string,
  options?: { appOrigin?: string }
): Promise<Uint8Array | undefined>;
