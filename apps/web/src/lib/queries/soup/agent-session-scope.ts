import { NIL_UUID } from '@app/features/next-soup/filters/configs/base';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNilIdLiteral(ast: unknown): boolean {
  if (!isRecord(ast) || !isRecord(ast.l)) return false;
  const fields = Object.keys(ast.l);
  return fields.length === 1 && ast.l.id === NIL_UUID;
}

function isNilIdExclusion(filter: Record<string, unknown>): boolean {
  const owners = filter.owners;
  const ids = filter.ids;
  return (
    filter.include !== true &&
    !(Array.isArray(owners) && owners.length > 0) &&
    Array.isArray(ids) &&
    ids.length === 1 &&
    ids[0] === NIL_UUID
  );
}

/**
 * Whether a soup request body (AST `asf` or legacy `agent_session_filters`)
 * can return agent sessions. They are opt-in on the server: an omitted
 * filter returns none, and the nil id is the explicit exclusion.
 */
export function bodyMayContainAgentSessions(body: unknown): boolean {
  if (!isRecord(body)) return false;
  if (body.asf != null) return !isNilIdLiteral(body.asf);
  const legacy = body.agent_session_filters;
  return isRecord(legacy) && !isNilIdExclusion(legacy);
}
