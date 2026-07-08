export type EntryAssetInfo = {
  freshIndexEntryUrl: string | null;
  loadedEntryUrl: string | null;
  matches: boolean | null;
  error?: string;
};

function normalizeAssetUrl(value: string): string {
  const url = new URL(value, window.location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

export function formatAssetUrl(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  try {
    const path = new URL(value, window.location.href).pathname;
    return path.split('/').filter(Boolean).at(-1) ?? value;
  } catch {
    return value;
  }
}

function extractEntryScriptUrl(html: string, indexUrl: string): string | null {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const entryScript = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src]'
  );
  const src = entryScript?.getAttribute('src');
  return src ? new URL(src, indexUrl).href : null;
}

export async function loadEntryAssetInfo(): Promise<EntryAssetInfo> {
  const loadedEntryUrl = window.__MACRO_RUNTIME_ENTRY_URL__ ?? null;
  if (!loadedEntryUrl) {
    return {
      freshIndexEntryUrl: null,
      loadedEntryUrl,
      matches: null,
      error: 'Runtime entry URL unavailable',
    };
  }

  try {
    const indexUrl = new URL('index.html', loadedEntryUrl);
    indexUrl.searchParams.set('__macro_bundle_probe', Date.now().toString());
    const browserFetch =
      window.__MACRO_BROWSER_FETCH__ ?? window.fetch.bind(window);
    const response = await browserFetch(indexUrl.href, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Fresh index fetch failed with ${response.status}`);
    }
    const freshIndexEntryUrl = extractEntryScriptUrl(
      await response.text(),
      indexUrl.href
    );
    return {
      freshIndexEntryUrl,
      loadedEntryUrl,
      matches:
        freshIndexEntryUrl !== null &&
        normalizeAssetUrl(loadedEntryUrl) ===
          normalizeAssetUrl(freshIndexEntryUrl),
    };
  } catch (error) {
    return {
      freshIndexEntryUrl: null,
      loadedEntryUrl,
      matches: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
