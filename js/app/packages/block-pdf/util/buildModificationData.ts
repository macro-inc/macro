import type Term from '../model/Term';
import type TocItem from '../model/TocItem';
import type { IBookmark } from '../type/Bookmark';
import {
  type IModificationData,
  type IModificationDataOnServer,
  transformModificationDataToServer,
} from '../type/coParse';
import type { IPlaceable } from '../type/placeables';
import { hashString, hashStringSync } from './hash';

export function getBookmarks(items: TocItem[]): IBookmark[] {
  return items.map(
    ({ section, children }): IBookmark => ({
      title: section.bookmarkTitle,
      pageNum: section.page,
      top: section.y,
      children: getBookmarks(children),
      id: section.id,
    })
  );
}

/**
 * Filter for excluding certain placeables from being saved as modification data
 * @returns false if the placeable should be excluded
 */
const savePlaceablesFilter = (p: IPlaceable) => {
  // filter out placeables that were added in app (as opposed to baked in) and then deleted
  if (p.originalIndex === -1 && p.wasDeleted) return false;

  if (p.payloadType === 'thread') return false;

  return true;
};

export function getSaveModificationData({
  pinnedTerms,
  TOCItems,
  placeables,
}: {
  placeables: IPlaceable[];
  TOCItems: TocItem[];
  pinnedTerms: Term[];
}): { modificationData: IModificationDataOnServer } {
  const pins = pinnedTerms.map((term) => term.name);
  const modificationData: IModificationData = {
    bookmarks: getBookmarks(TOCItems),
    placeables: placeables.filter(savePlaceablesFilter),
    pinnedTermsNames: pins,
  };

  const serverModificationData =
    transformModificationDataToServer(modificationData);

  return { modificationData: serverModificationData };
}

export const modificationDataReplacer = (key: string, value: any) => {
  // TODO: this is a workaround to convert the Set to an Array because JSON.stringify will return an empty object
  if (key === 'pageRange') {
    return Array.from(value);
  }

  // Workaround for floating point precision issues that were affecting hash consistency
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return parseFloat(value.toFixed(12));
  }

  return value;
};

export const hashModificationData = async (
  modificationData: IModificationData | IModificationDataOnServer
): Promise<string> => {
  return hashString(JSON.stringify(modificationData, modificationDataReplacer));
};

export const hashModificationDataSync = (
  modificationData: IModificationData | IModificationDataOnServer
): string => {
  return hashStringSync(
    JSON.stringify(modificationData, modificationDataReplacer)
  );
};
