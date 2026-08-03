import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import {
  PREVIEW_QUERY_PARAM,
  remapPreviewQueryForRemovedSplit,
} from '@components/app/split-layout/previewPersistence';

/**
 * Parse a base-relative app URL. The base only anchors parsing — inputs come
 * from the router's `location`, which is already URL-canonical — and only the
 * pathname/query/hash are ever read back out.
 */
const parseUrl = (url: string) => new URL(url, 'http://localhost');

/** Serialize a parsed URL back to its base-relative string form. */
const toRelativeUrl = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

/**
 * Drop a settings split from a base-relative split-layout URL, if present.
 * Handles both the URL encoding (`settings/<tab>`) and the legacy internal
 * form (`component/settings`). Only type positions (even indices) are
 * inspected so a block id that happens to be "settings" isn't mistaken for
 * one.
 *
 * The query string and hash are preserved. Removing a split shifts the URL
 * pair indices after it, so Preview Pairs declared in the `preview` query
 * param are remapped to keep pointing at the same splits (a pair that
 * referenced the settings split itself is dropped). When settings was the
 * only split there is no layout left to return to, so the default route is
 * returned bare.
 */
export const stripSettingsSplitFromUrl = (urlString: string): string => {
  const url = parseUrl(urlString);
  const segments = url.pathname.split('/').filter(Boolean);

  let removedSplitIndex: number | undefined;
  for (let i = 0; i + 1 < segments.length; i += 2) {
    const type = segments[i];
    if (
      type === 'settings' ||
      (type === 'component' && segments[i + 1] === 'settings')
    ) {
      removedSplitIndex = i / 2;
      segments.splice(i, 2);
      break;
    }
  }

  if (segments.length === 0) return DEFAULT_ROUTE;

  if (removedSplitIndex !== undefined) {
    const remappedPreview = remapPreviewQueryForRemovedSplit(
      url.searchParams.get(PREVIEW_QUERY_PARAM) ?? undefined,
      removedSplitIndex
    );
    if (remappedPreview === undefined) {
      url.searchParams.delete(PREVIEW_QUERY_PARAM);
    } else {
      url.searchParams.set(PREVIEW_QUERY_PARAM, remappedPreview);
    }
  }

  url.pathname = `/${segments.join('/')}`;
  return toRelativeUrl(url);
};

/**
 * Append a docked settings split (`settings/<slug>`) to a base-relative
 * split-layout URL, keeping its query string and hash. Appending at the end
 * leaves existing URL pair indices untouched, so Preview Pairs in the
 * `preview` query param stay valid as-is.
 */
export const appendSettingsSplitToUrl = (
  urlString: string,
  settingsTabSlug: string
): string => {
  const url = parseUrl(urlString);
  const base = url.pathname.replace(/\/$/, '');
  url.pathname = `${base}/settings/${settingsTabSlug}`;
  return toRelativeUrl(url);
};
