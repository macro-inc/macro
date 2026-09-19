import {
  type DateRangeFilter,
  FILTER_TARGETS,
  type FilterFieldMeta,
  type PropertyFilter,
  type Target,
} from './constants';

// a clause is a boolean over ONE target's fields; facets combine them
export type Leaf = { field: string; value: unknown };

export type TargetExpr =
  | Leaf
  | { not: TargetExpr }
  | { and: TargetExpr[] }
  | { or: TargetExpr[] };

export const eq = (field: string, value: unknown): Leaf => ({ field, value });
export const not = (expr: TargetExpr): TargetExpr => ({ not: expr });
export const and = (...exprs: TargetExpr[]): TargetExpr => ({ and: exprs });
export const or = (...exprs: TargetExpr[]): TargetExpr => ({ or: exprs });

export const clause = { eq, not, and, or };

export type BackendAstNode =
  | { '&': [BackendAstNode, BackendAstNode] }
  | { '|': [BackendAstNode, BackendAstNode] }
  | { '!': BackendAstNode }
  | { l: unknown };

export type BackendAstMap = Partial<Record<Target, BackendAstNode>>;

export const isBackendAstNode = (
  node: BackendAstNode | undefined
): node is BackendAstNode => node !== undefined;

export const AST = {
  or(asts: BackendAstNode[]): BackendAstNode | undefined {
    if (asts.length === 0) return undefined;
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '|': [ast, acc] }));
  },
  and(asts: BackendAstNode[]): BackendAstNode | undefined {
    if (asts.length === 0) return undefined;
    if (asts.length === 1) return asts[0];
    return asts.reduceRight((acc, ast) => ({ '&': [ast, acc] }));
  },
  not(ast: BackendAstNode): BackendAstNode {
    return { '!': ast };
  },
  literal(field: string, value?: unknown): BackendAstNode {
    return value === undefined ? { l: field } : { l: { [field]: value } };
  },
};

export const literal = AST.literal;

export const combine = (
  operator: '&' | '|',
  values: BackendAstNode[]
): BackendAstNode | undefined => {
  const [first, ...rest] = values;
  if (!first) return undefined;
  return rest.reduce<BackendAstNode>(
    (left, right) =>
      operator === '&' ? { '&': [left, right] } : { '|': [left, right] },
    first
  );
};

const expandDateRange = (field: string, range: DateRangeFilter) => {
  const asts: BackendAstNode[] = [];

  if (range.gt) asts.push(AST.literal(field, { gt: range.gt }));
  if (range.gte) asts.push(AST.literal(field, { gte: range.gte }));
  if (range.lt) asts.push(AST.literal(field, { lt: range.lt }));
  if (range.lte) asts.push(AST.literal(field, { lte: range.lte }));

  return asts;
};

const propertyToAst = (property: PropertyFilter): BackendAstNode =>
  property.type === 'select'
    ? { l: { pd: property.propertyId, v: { so: property.value } } }
    : { l: { pd: property.propertyId, v: { er: property.value } } };

const fieldMeta = (target: Target, field: string): FilterFieldMeta => {
  const targetFields = FILTER_TARGETS[target];
  return targetFields[field as keyof typeof targetFields];
};

const compileLeaf = (
  target: Target,
  { field, value }: Leaf
): BackendAstNode | undefined => {
  if (field === 'properties') return propertyToAst(value as PropertyFilter);

  const config = fieldMeta(target, field);

  if (!config) return undefined;

  if (config.compile === 'unit') {
    return value === true ? AST.literal(config.backend) : undefined;
  }

  if (config.compile === 'dateRange') {
    return AST.and(expandDateRange(config.backend, value as DateRangeFilter));
  }

  const format = config.formatValue ?? ((input: unknown) => input);

  return AST.literal(config.backend, format(value));
};

export const compileExpr = (
  target: Target,
  expr: TargetExpr
): BackendAstNode | undefined => {
  if ('and' in expr) {
    return AST.and(
      expr.and.map((e) => compileExpr(target, e)).filter(isBackendAstNode)
    );
  }

  if ('or' in expr) {
    return AST.or(
      expr.or.map((e) => compileExpr(target, e)).filter(isBackendAstNode)
    );
  }

  if ('not' in expr) {
    const child = compileExpr(target, expr.not);
    return child ? AST.not(child) : undefined;
  }

  return compileLeaf(target, expr);
};
