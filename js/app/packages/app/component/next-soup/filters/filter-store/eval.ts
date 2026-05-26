import type {
  EntityReference,
  SoupApiItem,
  SoupProperty,
} from '@service-storage/generated/schemas';
import type { ApiEntityFilterAst } from '@service-storage/generated/schemas/apiEntityFilterAst';
import { FIELD_CONFIG, type QueryTarget } from './compile';

function isRecord(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getSoupProperties(item: SoupApiItem) {
  switch (item.tag) {
    case 'document':
    case 'chat':
    case 'project':
    case 'emailThread':
      return item.data.properties;
    case 'channel':
    case 'call':
      return;
  }
}

function isSelectOptionValue(
  value: SoupProperty['value']
): value is Extract<SoupProperty['value'], { type: 'SelectOption' }> {
  return value?.type === 'SelectOption';
}

function isEntityReferenceValue(
  value: SoupProperty['value']
): value is Extract<SoupProperty['value'], { type: 'EntityReference' }> {
  return value?.type === 'EntityReference';
}

function getAstTarget(item: SoupApiItem) {
  switch (item.tag) {
    case 'document':
      return 'df';
    case 'emailThread':
      return 'ef';
    case 'channel':
      return 'chanf';
    case 'chat':
      return 'cf';
    case 'project':
      return 'pf';
    case 'call':
      return 'callf';
  }
}

function evalAst(
  ast: unknown,
  literalMatches: (literal: Record<string, unknown>) => boolean | undefined
): boolean | undefined {
  if (!isRecord(ast)) return;

  const node = ast as Record<string, unknown>;

  if ('&' in node && Array.isArray(node['&'])) {
    const [left, right] = node['&'];

    const l = evalAst(left, literalMatches);
    const r = evalAst(right, literalMatches);

    if (l === undefined || r === undefined) return;

    return l && r;
  }

  if ('|' in node && Array.isArray(node['|'])) {
    const [left, right] = node['|'];

    const l = evalAst(left, literalMatches);
    const r = evalAst(right, literalMatches);

    if (l === undefined || r === undefined) return;

    return l || r;
  }

  if ('!' in node) {
    const v = evalAst(node['!'], literalMatches);

    if (v === undefined) return;

    return !v;
  }

  if ('l' in node && isRecord(node.l)) {
    return literalMatches(node.l as Record<string, unknown>);
  }
}

function literalValueMatches(expected: unknown, actual: unknown) {
  if (isRecord(expected)) return;
  return expected === actual;
}

function evalEntityLiteral(
  item: SoupApiItem,
  target: QueryTarget,
  literal: Record<string, unknown>
) {
  const entries = Object.entries(literal);
  if (entries.length === 0) return true;

  for (const [field, expected] of entries) {
    const config = Object.values(FIELD_CONFIG).find(
      (c) => c.target === target && c.field === field
    );
    if (!config?.getValue) return;

    const matched = literalValueMatches(expected, config.getValue(item));
    if (matched !== true) return matched;
  }

  return true;
}

function evalPropertyLiteral(
  item: SoupApiItem,
  literal: Record<string, unknown>
) {
  const propertyDefinitionId = literal.pd;
  const value = literal.v;
  if (typeof propertyDefinitionId !== 'string' || !isRecord(value)) {
    return;
  }
  const properties = getSoupProperties(item);
  if (!properties) return false;

  const property = properties.find(
    (p) => p.definition.id === propertyDefinitionId
  );
  const propertyValue = property?.value;
  if (!propertyValue) return false;

  const expected = value as Record<string, unknown>;

  if ('so' in expected && isSelectOptionValue(propertyValue)) {
    return (
      typeof expected.so === 'string' &&
      propertyValue.value.includes(expected.so)
    );
  }
  if ('er' in expected && isEntityReferenceValue(propertyValue)) {
    return (
      typeof expected.er === 'string' &&
      propertyValue.value.some(
        (ref: EntityReference) => ref.entity_id === expected.er
      )
    );
  }
}

/** Conservative AST filter used only to decide whether optimistic insertion is safe. */
export function filterSoupItemByAstBody(
  item: SoupApiItem,
  body: ApiEntityFilterAst
) {
  const target = getAstTarget(item);
  const entityAst = body[target];
  const propertyAst = body.propf;

  const entityMatches = entityAst
    ? evalAst(entityAst, (literal) => evalEntityLiteral(item, target, literal))
    : true;
  const propertyMatches = propertyAst
    ? evalAst(propertyAst, (literal) => evalPropertyLiteral(item, literal))
    : true;

  return entityMatches === true && propertyMatches === true;
}
