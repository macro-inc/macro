import { modificationDataReplacer } from '@coparse/document-processing-types';
import type Term from '../model/Term';
import {
  type IModificationData,
  type IModificationDataOnServer,
  transformModificationDataToServer,
} from '../type/coParse';
import type { IPlaceable } from '../type/placeables';
import { hashString, hashStringSync } from './hash';

export { modificationDataReplacer };

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
  placeables,
}: {
  placeables: IPlaceable[];
  pinnedTerms: Term[];
}): { modificationData: IModificationDataOnServer } {
  const pins = pinnedTerms.map((term) => term.name);
  const modificationData: IModificationData = {
    bookmarks: [],
    placeables: placeables.filter(savePlaceablesFilter),
    pinnedTermsNames: pins,
  };

  const serverModificationData =
    transformModificationDataToServer(modificationData);

  return { modificationData: serverModificationData };
}

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
