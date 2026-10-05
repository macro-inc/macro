import type { SplitContent, SplitContentType } from './layoutManager';

/** Build a bare content reference without loading the split registry. */
export function contentReference(
  type: SplitContentType,
  id: string
): SplitContent {
  // Split the union to stay within TypeScript's discriminant expansion limit.
  return type === 'component' ? { type, id } : { type, id };
}
