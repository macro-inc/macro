import { ModelEnum } from '@service-cognition/generated/schemas';
import type { Model } from '../types';

/**
 * Parses a Model type from a string.
 * Returns undefined if unable to parse
 */
export const parseModel = (
  value: string | null | undefined
): Model | undefined => {
  if (!value) return undefined;
  const result = ModelEnum.safeParse(value);
  if (result.success) return result.data;
  return undefined;
};
