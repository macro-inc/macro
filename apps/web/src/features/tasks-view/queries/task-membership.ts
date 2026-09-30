import {
  type BackendAstNode,
  literal,
} from '@app/features/soup/filters/facets/clause';
import { NIL_ID as NIL_UUID } from '@app/features/soup/filters/facets/constants';

export const taskMembershipScope = (ids: readonly string[]): BackendAstNode => {
  if (!ids.length) return literal('id', NIL_UUID);
  // A project may contain thousands of tasks. Balance the binary AST to stay
  // below the JSON parser's recursion limit while keeping every membership ID.
  let level = ids.map((id) => literal('id', id));
  while (level.length > 1) {
    const next: BackendAstNode[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      next.push(right ? { '|': [level[index], right] } : level[index]);
    }
    level = next;
  }
  return level[0];
};
