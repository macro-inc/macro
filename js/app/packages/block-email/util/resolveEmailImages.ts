import { SERVER_HOSTS } from '@core/constant/servers';
import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import type { ApiMessage } from '@service-email/generated/schemas';

/** Resolves cid: URLs in <img> tags to their static-file-service equivalents. */
export function resolveCidImages(
  root: ShadowRoot,
  attachments: ApiMessage['attachments']
): void {
  const contentIdToSfsId = new Map<string, string>();
  for (const att of attachments ?? []) {
    const contentId = att.content_id;
    const sfsId = att.sfs_id;
    if (!contentId || !sfsId) continue;
    const normalized = contentId.replace(/[<>]/g, '');
    contentIdToSfsId.set(normalized, sfsId);
  }

  const cidImages = root.querySelectorAll('img[src^="cid:"]');
  for (const img of cidImages) {
    if (!(img instanceof HTMLImageElement)) continue;
    if (img.dataset.cidResolved === 'true') continue;
    const src = img.getAttribute('src');
    if (!src?.startsWith('cid:')) continue;
    const rawCid = src.slice(4);
    const normalizedCid = rawCid.replace(/[<>]/g, '');
    const sfsId = contentIdToSfsId.get(normalizedCid);
    if (!sfsId) continue;
    img.src = `${SERVER_HOSTS['static-file']}/file/${sfsId}`;
    img.dataset.cidResolved = 'true';
  }
}

/**
 * In Tauri, the WebView's native image loading uses a separate cookie store
 * from the reqwest cookie jar that holds auth credentials, so bare <img> src
 * requests to authenticated services (image proxy, static-file) get a 401.
 * This fetches all HTTPS images through platformFetch (which uses reqwest) and
 * swaps their src for blob URLs. Must be called after resolveCidImages so that
 * cid: URLs are already resolved to https:// before this runs.
 */
export async function fetchImagesViaPlatform(
  root: ShadowRoot,
  blobUrls: string[],
  isDisposed: () => boolean
): Promise<void> {
  if (!isTauri()) return;

  const httpsImages = Array.from(root.querySelectorAll('img[src^="https://"]'));
  await Promise.all(
    httpsImages.map(async (img) => {
      if (!(img instanceof HTMLImageElement)) return;
      if (img.dataset.tauriFetched === 'true') return;
      const src = img.getAttribute('src');
      if (!src) return;
      try {
        // Check isDisposed() after every await boundary. The parent effect's
        // onCleanup only revokes URLs present in blobUrls at cleanup time, so
        // any blob URL created after cleanup runs would leak. Bailing out early
        // avoids creating those URLs; the final check after createObjectURL
        // handles the race where disposal occurs between the blob() await and
        // the URL being created.
        const response = await platformFetch(src);
        if (isDisposed()) return;
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.startsWith('image/')) return;
        const blob = await response.blob();
        if (isDisposed()) return;
        const blobUrl = URL.createObjectURL(blob);
        if (isDisposed()) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        blobUrls.push(blobUrl);
        img.src = blobUrl;
        img.dataset.tauriFetched = 'true';
      } catch {
        // Leave the src as-is on failure so the image shows as broken
        // rather than silently disappearing.
      }
    })
  );
}
