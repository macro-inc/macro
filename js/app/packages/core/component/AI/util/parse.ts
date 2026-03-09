import { Model } from '../types';

const modelValues = new Set(Object.values(Model));

/**
 * Parses a Model type from a string.
 * Returns undefined if unable to parse
 */
export const parseModel = (
  value: string | null | undefined
): Model | undefined => {
  if (!value) return undefined;
  if (modelValues.has(value as Model)) return value as Model;
  return undefined;
};
