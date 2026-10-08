import {
  copyImageToClipboard,
  downloadImage as downloadImageAction,
} from '@core/util/imageActions';
import { platformFetch } from '@core/util/platformFetch';
import { isIOS } from '@solid-primitives/platform';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';

type ImageActionsInput = {
  // Current image to display.
  src: Accessor<string | undefined>;
  // Used for the download filename.
  imageId: Accessor<string>;
  // Optional pre-fetched blob override (e.g. DSS images). Falls back to fetching `src`.
  getBlob?: () => Promise<Blob | undefined>;
};

/**
 * Copy / download for the current image, with an iOS pre-fetch so the blob is
 * in memory before the user taps. Exposes loading flags so the buttons can show
 * a spinner and stay disabled until the share is guaranteed to be synchronous.
 */
export function createImageActions(input: ImageActionsInput) {
  const fetchBlob = async (): Promise<Blob | undefined> => {
    if (input.getBlob) return input.getBlob();
    const url = input.src();
    if (!url) return undefined;
    return (await platformFetch(url)).blob();
  };

  // Pre-fetch the blob on iOS so it is already in memory when the user taps
  // copy/download. This keeps navigator.share() close to synchronous with the
  // gesture — the user-activation window expires if a network round-trip is
  // needed. Desktop clipboard doesn't have this constraint.
  const [cachedBlob, setCachedBlob] = createSignal<Blob | undefined>();
  // True while the iOS pre-fetch is in flight. We surface this as a loading
  // state on the copy/download buttons so the blob is guaranteed to be in
  // memory before the user can tap. Without this, tapping download on a large
  // image (whose pre-fetch hasn't finished yet) falls through to an awaited
  // network fetch, which consumes the tap's user activation and makes
  // navigator.share() silently no-op until a second tap.
  const [isPrefetching, setIsPrefetching] = createSignal(false);
  if (isIOS) {
    createEffect(() => {
      const currentSrc = input.src(); // re-fetch when navigating to a new image
      let isStale = false;
      onCleanup(() => {
        isStale = true;
      });

      setCachedBlob(undefined);
      setIsPrefetching(true);
      untrack(() => fetchBlob())
        .then((blob) => {
          if (isStale || input.src() !== currentSrc) return;
          if (blob) setCachedBlob(blob);
        })
        .catch(() => {})
        .finally(() => {
          if (!isStale && input.src() === currentSrc) setIsPrefetching(false);
        });
    });
  }
  const fetchBlobCached = (): Promise<Blob | undefined> => {
    const cached = cachedBlob();
    return cached ? Promise.resolve(cached) : fetchBlob();
  };

  const [activeAction, setActiveAction] = createSignal<
    'copy' | 'download' | undefined
  >();
  const isBusy = () => activeAction() != null;
  const isCopying = () => activeAction() === 'copy';
  const isDownloading = () => activeAction() === 'download';

  const copyToClipboard = async () => {
    if (isBusy()) return;
    setActiveAction('copy');
    try {
      await copyImageToClipboard(fetchBlobCached, input.src() ?? '');
    } finally {
      setActiveAction(undefined);
    }
  };

  const downloadImage = async () => {
    if (isBusy()) return;
    setActiveAction('download');
    try {
      await downloadImageAction(fetchBlobCached, input.imageId());
    } finally {
      setActiveAction(undefined);
    }
  };

  return {
    isPrefetching,
    isBusy,
    isCopying,
    isDownloading,
    copyToClipboard,
    downloadImage,
  };
}
