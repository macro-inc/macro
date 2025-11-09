import { debounce } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { UnfurlServiceClient } from '@service-unfurl/client';
import type { GetUnfurlResponse } from '@service-unfurl/generated/schemas/getUnfurlResponse';
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
} from 'solid-js';
import { createStore } from 'solid-js/store';

/** Default cache duration in seconds */
const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

type UnfurledLinkError = { type: 'error'; _createdAt: Date };
type UnfurledLinkLoading = { type: 'loading'; _createdAt: Date };
type UnfurledLinkSuccess = {
  type: 'success';
  data: GetUnfurlResponse;
  _createdAt: Date;
};

export type UnfurledLinkData =
  | UnfurledLinkError
  | UnfurledLinkLoading
  | UnfurledLinkSuccess;

type UnfurlStore = Record<string, UnfurledLinkData>;

const [unfurlStore, setUnfurlStore] = createStore<UnfurlStore>({});
const [unfurlFetchQueue, setUnfurlFetchQueue] = createSignal<string[]>([]);

/** Adds URLs to fetch queue and schedules processing */
function queueUrlsForFetch(urls: string[]) {
  const existingQueue = unfurlFetchQueue();
  const newUrls = urls.filter((url) => !existingQueue.includes(url));
  if (newUrls.length > 0) {
    setUnfurlFetchQueue((prev) => [...prev, ...newUrls]);
  }
}

const processFetchQueue = debounce(async () => {
  const urls = unfurlFetchQueue();
  if (urls.length === 0) return;

  setUnfurlFetchQueue([]);

  const urlsToFetch = urls.filter((url) => {
    const cached = unfurlStore[url];
    return !cached || cached.type !== 'loading';
  });

  if (urlsToFetch.length === 0) return;

  await batchFetchUnfurls(urlsToFetch);
}, 50);

// Shared global effect to process the unfurl queue
createRoot(() =>
  createEffect(() => {
    const queue = unfurlFetchQueue();
    if (queue.length > 0) {
      processFetchQueue();
    }
  })
);

async function batchFetchUnfurls(urls: string[]) {
  const updates: UnfurlStore = {};
  urls.forEach((url) => {
    updates[url] = { type: 'loading', _createdAt: new Date() };
  });
  setUnfurlStore(updates);

  const result = await UnfurlServiceClient.unfurlBulk({ url_list: urls });

  if (isErr(result)) {
    console.error('Failed to fetch unfurl bulk data');
    const errorUpdates: UnfurlStore = {};
    urls.forEach((url) => {
      errorUpdates[url] = { type: 'error', _createdAt: new Date() };
    });
    setUnfurlStore(errorUpdates);
    return;
  }

  const [, data] = result;
  const successUpdates: UnfurlStore = {};

  data.responses.forEach((unfurl) => {
    if (unfurl && unfurl.url) {
      successUpdates[unfurl.url] = {
        type: 'success',
        data: unfurl as GetUnfurlResponse,
        _createdAt: new Date(),
      };
    }
  });

  urls.forEach((url) => {
    if (!successUpdates[url]) {
      successUpdates[url] = { type: 'error', _createdAt: new Date() };
    }
  });

  setUnfurlStore(successUpdates);
}

function isCacheExpired(cached: UnfurledLinkData | undefined): boolean {
  return (
    !cached ||
    (cached.type !== 'loading' &&
      Date.now() - cached._createdAt.getTime() >
        DEFAULT_CACHE_TIME_SECONDS * 1000)
  );
}

export type UnfurlFetcher = [
  Accessor<UnfurledLinkData | undefined>,
  {
    refetch: () => void;
  },
];

/**
 * Hook to fetch and manage URL unfurls with caching and batch processing
 *
 * @param url - URL to unfurl
 * @returns Tuple of unfurl data accessor and control functions
 *
 * @example
 * const [unfurlData, { refetch }] = useUnfurl("https://example.com");
 *
 * createEffect(() => {
 *   const data = unfurlData();
 *   if (data && data.type === 'success') {
 *     console.log("Unfurl loaded:", data.data);
 *   }
 * });
 */
export function useUnfurl(url: string | undefined): UnfurlFetcher {
  if (!url) {
    return [() => undefined, { refetch: () => {} }];
  }

  const cached = unfurlStore[url];
  if (isCacheExpired(cached)) {
    queueUrlsForFetch([url]);
  }

  const accessor = () => unfurlStore[url];

  const controls = {
    refetch: () => {
      setUnfurlStore(url, {
        type: 'loading',
        _createdAt: new Date(),
      });
      queueUrlsForFetch([url]);
    },
  };

  return [accessor, controls];
}

/**
 * Prefetch multiple URLs at once
 * Useful for preloading unfurls when you know multiple URLs will be needed
 */
export function prefetchUnfurls(urls: string[]) {
  const urlsToFetch = urls.filter((url) => isCacheExpired(unfurlStore[url]));

  if (urlsToFetch.length > 0) {
    queueUrlsForFetch(urlsToFetch);
  }
}

/**
 * Get unfurl data from cache without triggering a fetch
 */
export function getCachedUnfurl(url: string): UnfurledLinkData | undefined {
  return unfurlStore[url];
}
