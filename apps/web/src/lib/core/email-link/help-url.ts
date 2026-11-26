export function imapHelpUrl(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.href;
  } catch {
    return;
  }
}
