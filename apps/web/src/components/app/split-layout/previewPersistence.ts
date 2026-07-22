import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import type { SplitContent } from './layoutManager';
import { decodePairs } from './layoutUtils';

/** Query parameter carrying controller/viewer preview relationships. */
export const PREVIEW_QUERY_PARAM = 'preview';

/** A preview association keyed by its controller's stable URL-order index. */
export type PreviewLinkUrlEntry = {
  controllerIndex: number;
};

/** URL content plus preview associations restored from its query string. */
export type RestorablePreviewLayout = {
  pairs: SplitContent[];
  links: PreviewLinkUrlEntry[];
};

export type PreviewQueryValue = string | string[] | undefined;

function isPreviewLinkUrlEntry(
  value: PreviewLinkUrlEntry
): value is PreviewLinkUrlEntry {
  return Number.isInteger(value.controllerIndex) && value.controllerIndex >= 0;
}

function parsePreviewLinks(value: PreviewQueryValue): PreviewLinkUrlEntry[] {
  if (typeof value !== 'string' || value.length === 0) return [];

  return value.split('_').flatMap((tuple): PreviewLinkUrlEntry[] => {
    if (!/^\d+$/.test(tuple)) return [];

    const entry: PreviewLinkUrlEntry = {
      controllerIndex: Number(tuple),
    };
    return isPreviewLinkUrlEntry(entry) ? [entry] : [];
  });
}

/** Serialize preview relationships into their canonical compact query value. */
export function serializePreviewLinks(
  links: readonly PreviewLinkUrlEntry[]
): string | undefined {
  const value = links
    .filter(isPreviewLinkUrlEntry)
    .toSorted((a, b) => a.controllerIndex - b.controllerIndex)
    .map(({ controllerIndex }) => String(controllerIndex))
    .join('_');
  return value || undefined;
}

function isListContent(content: SplitContent): boolean {
  return content.type === 'component' && isListViewID(content.id);
}

function isPreviewEmpty(content: SplitContent): boolean {
  return content.type === 'component' && content.id === 'preview-empty';
}

function validLinksForPairs(
  pairs: readonly SplitContent[],
  links: readonly PreviewLinkUrlEntry[]
): PreviewLinkUrlEntry[] {
  const claimedIndices = new Set<number>();
  const valid: PreviewLinkUrlEntry[] = [];

  for (const link of links) {
    const viewerIndex = link.controllerIndex + 1;
    const controller = pairs[link.controllerIndex];
    const viewer = pairs[viewerIndex];
    if (!controller || !viewer) continue;
    if (!isListContent(controller) || isListContent(viewer)) continue;
    if (
      claimedIndices.has(link.controllerIndex) ||
      claimedIndices.has(viewerIndex)
    ) {
      continue;
    }
    claimedIndices.add(link.controllerIndex);
    claimedIndices.add(viewerIndex);
    valid.push(link);
  }

  return valid.sort((a, b) => a.controllerIndex - b.controllerIndex);
}

/**
 * Decode a URL layout and restore preview links declared by its query string.
 * Unlinked `preview-empty` entries are removed so the internal placeholder can
 * never load as an independent split.
 */
export function loadRestorablePreviewLayout(
  segments: readonly string[],
  previewQuery: PreviewQueryValue,
  options: { allowPreviewLinks?: boolean } = {}
): RestorablePreviewLayout {
  const decoded = decodePairs([...segments]);
  const queryLinks =
    options.allowPreviewLinks === false ? [] : parsePreviewLinks(previewQuery);
  const validLinks = validLinksForPairs(decoded, queryLinks);
  const linkedViewerIndices = new Set(
    validLinks.map((link) => link.controllerIndex + 1)
  );

  const keptPairs: SplitContent[] = [];
  const remappedIndices = new Map<number, number>();
  decoded.forEach((content, index) => {
    if (isPreviewEmpty(content) && !linkedViewerIndices.has(index)) return;
    remappedIndices.set(index, keptPairs.length);
    keptPairs.push(content);
  });

  if (keptPairs.length === 0) {
    return {
      pairs: [{ type: 'component', id: LIST_VIEW_ID.inbox }],
      links: [],
    };
  }

  return {
    pairs: keptPairs,
    links: validLinks.flatMap((link): PreviewLinkUrlEntry[] => {
      const controllerIndex = remappedIndices.get(link.controllerIndex);
      const viewerIndex = remappedIndices.get(link.controllerIndex + 1);
      return controllerIndex === undefined ||
        viewerIndex !== controllerIndex + 1
        ? []
        : [{ ...link, controllerIndex }];
    }),
  };
}
