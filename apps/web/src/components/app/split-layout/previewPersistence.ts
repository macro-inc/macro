import { LIST_VIEW_ID } from '@app/constants/list-views';
import type { SplitContent } from './layoutManager';
import { decodePairs } from './layoutUtils';
import { isPreviewControllerContent } from './previewController';

/** Query parameter carrying Controller/Viewer Preview Pairs. */
export const PREVIEW_QUERY_PARAM = 'preview';

/** A Preview Pair keyed by its Controller's stable URL-order index. */
export type PreviewPairUrlEntry = {
  controllerIndex: number;
};

/** URL content plus Preview Pairs restored from its query string. */
export type RestorablePreviewLayout = {
  contents: SplitContent[];
  previewPairs: PreviewPairUrlEntry[];
};

export type PreviewQueryValue = string | string[] | undefined;

function isPreviewPairUrlEntry(
  value: PreviewPairUrlEntry
): value is PreviewPairUrlEntry {
  return Number.isInteger(value.controllerIndex) && value.controllerIndex >= 0;
}

function parsePreviewPairs(value: PreviewQueryValue): PreviewPairUrlEntry[] {
  if (typeof value !== 'string' || value.length === 0) return [];

  return value.split('_').flatMap((tuple): PreviewPairUrlEntry[] => {
    if (!/^\d+$/.test(tuple)) return [];

    const entry: PreviewPairUrlEntry = {
      controllerIndex: Number(tuple),
    };
    return isPreviewPairUrlEntry(entry) ? [entry] : [];
  });
}

/** Serialize Preview Pairs into their canonical compact query value. */
export function serializePreviewPairs(
  previewPairs: readonly PreviewPairUrlEntry[]
): string | undefined {
  const value = previewPairs
    .filter(isPreviewPairUrlEntry)
    .toSorted((a, b) => a.controllerIndex - b.controllerIndex)
    .map(({ controllerIndex }) => String(controllerIndex))
    .join('_');
  return value || undefined;
}

/**
 * Remap a preview query value for a layout whose split at `removedSplitIndex`
 * (URL pair order) is being removed. A Preview Pair whose Controller or Viewer
 * was the removed split is dropped; Controller indices past it shift down by
 * one so the remaining pairs keep pointing at the same splits. Returns the
 * serialized value, or `undefined` when no pairs survive.
 */
export function remapPreviewQueryForRemovedSplit(
  previewQuery: PreviewQueryValue,
  removedSplitIndex: number
): string | undefined {
  const remapped = parsePreviewPairs(previewQuery).flatMap(
    (previewPair): PreviewPairUrlEntry[] => {
      const viewerIndex = previewPair.controllerIndex + 1;
      if (
        previewPair.controllerIndex === removedSplitIndex ||
        viewerIndex === removedSplitIndex
      ) {
        return [];
      }
      return [
        previewPair.controllerIndex > removedSplitIndex
          ? { controllerIndex: previewPair.controllerIndex - 1 }
          : previewPair,
      ];
    }
  );
  return serializePreviewPairs(remapped);
}

function isPreviewEmpty(content: SplitContent): boolean {
  return content.type === 'component' && content.id === 'preview-empty';
}

function validPreviewPairsForContents(
  contents: readonly SplitContent[],
  previewPairs: readonly PreviewPairUrlEntry[]
): PreviewPairUrlEntry[] {
  const claimedIndices = new Set<number>();
  const valid: PreviewPairUrlEntry[] = [];

  for (const previewPair of previewPairs) {
    const viewerIndex = previewPair.controllerIndex + 1;
    const controller = contents[previewPair.controllerIndex];
    const viewer = contents[viewerIndex];
    if (!controller || !viewer) continue;
    // Only the Controller's content type is constrained — a Viewer may itself
    // be controller-eligible (e.g. a Project controlling another Project),
    // matching the runtime's canLinkPreviewPair. Double-role assignment is
    // prevented by claimedIndices below.
    if (!isPreviewControllerContent(controller)) {
      continue;
    }
    if (
      claimedIndices.has(previewPair.controllerIndex) ||
      claimedIndices.has(viewerIndex)
    ) {
      continue;
    }
    claimedIndices.add(previewPair.controllerIndex);
    claimedIndices.add(viewerIndex);
    valid.push(previewPair);
  }

  return valid.sort((a, b) => a.controllerIndex - b.controllerIndex);
}

/**
 * Decode a URL layout and restore Preview Pairs declared by its query string.
 * Unlinked `preview-empty` entries are removed so the internal placeholder can
 * never load as an independent split.
 */
export function loadRestorablePreviewLayout(
  segments: readonly string[],
  previewQuery: PreviewQueryValue,
  options: { allowPreviewPairs?: boolean } = {}
): RestorablePreviewLayout {
  const decoded = decodePairs([...segments]);
  const queryPreviewPairs =
    options.allowPreviewPairs === false ? [] : parsePreviewPairs(previewQuery);
  const validPreviewPairs = validPreviewPairsForContents(
    decoded,
    queryPreviewPairs
  );
  const linkedViewerIndices = new Set(
    validPreviewPairs.map((previewPair) => previewPair.controllerIndex + 1)
  );

  const keptContents: SplitContent[] = [];
  const remappedIndices = new Map<number, number>();
  decoded.forEach((content, index) => {
    if (isPreviewEmpty(content) && !linkedViewerIndices.has(index)) return;
    remappedIndices.set(index, keptContents.length);
    keptContents.push(content);
  });

  if (keptContents.length === 0) {
    return {
      contents: [{ type: 'component', id: LIST_VIEW_ID.inbox }],
      previewPairs: [],
    };
  }

  return {
    contents: keptContents,
    previewPairs: validPreviewPairs.flatMap(
      (previewPair): PreviewPairUrlEntry[] => {
        const controllerIndex = remappedIndices.get(
          previewPair.controllerIndex
        );
        const viewerIndex = remappedIndices.get(
          previewPair.controllerIndex + 1
        );
        return controllerIndex === undefined ||
          viewerIndex !== controllerIndex + 1
          ? []
          : [{ ...previewPair, controllerIndex }];
      }
    ),
  };
}
