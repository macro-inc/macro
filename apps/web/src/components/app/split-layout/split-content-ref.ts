import type { SplitContent, SplitContentType } from './layoutManager';

/**
 * `{ type, id }` for any split content type. Branching narrows `type` for each
 * union member; TypeScript stops relating a union-typed discriminant to a
 * discriminated union once the discriminant has more than 25 members.
 */
export function splitContentRef(
  type: SplitContentType,
  id: string
): SplitContent {
  return type === 'component' ? { type, id } : { type, id };
}
