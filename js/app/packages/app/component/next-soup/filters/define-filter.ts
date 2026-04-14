import type { EntityData } from '@entity';

export type AstBucket = 'df' | 'pf' | 'cf' | 'ef' | 'chanf' | 'propf';

/**
 * AST expression type (matches server format).
 * Used when astLiteral needs to return a complete expression.
 */
export type AstExpr =
  | { '&': [AstExpr, AstExpr] }
  | { '|': [AstExpr, AstExpr] }
  | { '!': AstExpr }
  | { l: unknown };

/**
 * Shorthand helpers for common AST literal patterns.
 */
export const ast = {
  lit: (value: unknown): AstExpr => ({ l: value }),
  not: (e: AstExpr): AstExpr => ({ '!': e }),
  and: (a: AstExpr, b: AstExpr): AstExpr => ({ '&': [a, b] }),
  or: (a: AstExpr, b: AstExpr): AstExpr => ({ '|': [a, b] }),
  /** Creates { key: value } literal */
  eq: (key: string, value: unknown): AstExpr => ({ l: { [key]: value } }),
  /** Creates negated { key: value } literal */
  neq: (key: string, value: unknown): AstExpr => ({
    '!': { l: { [key]: value } },
  }),
  /** Creates property filter: { pd: defId, v: { so: optionId } } */
  propSelect: (defId: string, optionId: string): AstExpr => ({
    l: { pd: defId, v: { so: optionId } },
  }),
  /** Creates property filter: { pd: defId, v: { er: entityId } } */
  propEntity: (defId: string, entityId: string): AstExpr => ({
    l: { pd: defId, v: { er: entityId } },
  }),
};

export type EmailView = 'inbox' | 'all' | 'drafts' | 'sent';

/** NIL UUID used to represent "no value" in filters */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export type FilterAst = Partial<Record<AstBucket, AstExpr>> & {
  /** Email view filter - applies at query level, not AST bucket level */
  emailView?: EmailView;
};

export type DefineFilterConfig<
  TContext = object,
  TId extends string = string,
> = {
  readonly id: TId;
  readonly label?: string;
  readonly group?: string;
  readonly predicate:
    | ((entity: EntityData) => boolean)
    | ((entity: EntityData, ctx: TContext) => boolean);
  readonly ast?: (ctx: TContext) => FilterAst;
};

export type DefinedFilter<TContext = object, TId extends string = string> = {
  readonly id: TId;
  readonly label?: string;
  readonly group?: string;
  readonly predicate:
    | ((entity: EntityData) => boolean)
    | ((entity: EntityData, ctx: TContext) => boolean);
  readonly ast: (ctx: TContext) => FilterAst;
  readonly test: (entity: EntityData, ctx?: TContext) => boolean;
  readonly toAst: (ctx?: TContext) => FilterAst;
};

export function defineFilter<
  TContext = object,
  const TId extends string = string,
>(config: DefineFilterConfig<TContext, TId>): DefinedFilter<TContext, TId> {
  const { id, label, group, predicate, ast: astConfig = () => ({}) } = config;

  return {
    id,
    label,
    group,
    predicate,
    ast: astConfig,
    test: (entity: EntityData, ctx?: TContext) => {
      return predicate(entity, ctx as TContext);
    },
    toAst: (ctx?: TContext) => {
      return astConfig(ctx as TContext);
    },
  };
}

export type FilterGroupConfig = {
  readonly id: string;
  readonly allowMultiple?: boolean;
};

export type FilterId<T extends DefinedFilter<unknown, string>> = T['id'];

const AST_BUCKETS = new Set<string>(['df', 'pf', 'cf', 'ef', 'chanf', 'propf']);

/** Default exclusion expressions for each bucket (matches id: NIL to exclude that entity type) */
const BUCKET_EXCLUSIONS: Record<AstBucket, AstExpr> = {
  df: { l: { id: NIL_UUID } },
  ef: { l: { ThreadId: NIL_UUID } },
  chanf: { l: { ChannelId: NIL_UUID } },
  pf: { l: { ProjectId: NIL_UUID } },
  cf: { l: { ChatId: NIL_UUID } },
  propf: { l: { pd: NIL_UUID } },
};

/** Entity buckets that should get default exclusions when not included */
const ENTITY_BUCKETS: AstBucket[] = ['df', 'ef', 'chanf', 'pf', 'cf'];

/**
 * Scopes a FilterAst to only include specified buckets.
 * emailView is always preserved if present.
 */
export function scopeFilterAst(
  filterAst: FilterAst,
  buckets: AstBucket[]
): FilterAst {
  const result: FilterAst = {};
  if (filterAst.emailView) {
    result.emailView = filterAst.emailView;
  }
  for (const bucket of buckets) {
    if (filterAst[bucket]) {
      result[bucket] = filterAst[bucket];
    }
  }
  return result;
}

/**
 * Internal helper to merge FilterAst objects with a specified combine function.
 */
function mergeFilterAstWith(
  combine: (a: AstExpr, b: AstExpr) => AstExpr,
  asts: FilterAst[]
): Partial<Record<AstBucket, AstExpr>> & { emailView?: EmailView } {
  const bucketExprs: Partial<Record<AstBucket, AstExpr>> = {};
  let emailView: EmailView | undefined;

  for (const filterAst of asts) {
    if (filterAst.emailView) {
      emailView = filterAst.emailView;
    }

    for (const [key, expr] of Object.entries(filterAst)) {
      if (!AST_BUCKETS.has(key) || !expr) continue;

      const bucket = key as AstBucket;
      const existing = bucketExprs[bucket];
      if (existing) {
        bucketExprs[bucket] = combine(existing, expr as AstExpr);
      } else {
        bucketExprs[bucket] = expr as AstExpr;
      }
    }
  }

  return { ...bucketExprs, emailView };
}

/**
 * Merges multiple FilterAst objects using OR logic within each bucket.
 * - Expressions for the same bucket are ORed together
 * - Does NOT add default exclusions (caller should handle that)
 * - For emailView, the last defined value wins
 */
export function mergeFilterAstOr(...asts: FilterAst[]): FilterAst {
  if (asts.length === 0) return {};
  return mergeFilterAstWith(ast.or, asts);
}

/**
 * Merges multiple FilterAst objects into a single FilterAst.
 * - Expressions for the same bucket are ANDed together
 * - Buckets not included get default exclusions (id: NIL) to exclude those entity types
 * - For emailView, the last defined value wins
 */
export function mergeFilterAst(...asts: FilterAst[]): FilterAst {
  const merged = mergeFilterAstWith(ast.and, asts);
  const { emailView, ...bucketExprs } = merged;

  // Build final result
  const result: FilterAst = {};

  if (emailView) {
    result.emailView = emailView;
  }

  // Add expressions for included buckets, add exclusions for non-included entity buckets
  for (const bucket of ENTITY_BUCKETS) {
    const expr = bucketExprs[bucket as AstBucket];
    if (expr) {
      result[bucket] = expr;
    } else {
      // Bucket not included - add default exclusion to filter out this entity type
      result[bucket] = BUCKET_EXCLUSIONS[bucket];
    }
  }

  // Add propf if it has an expression (no default exclusion for property filters)
  if (bucketExprs.propf) {
    result.propf = bucketExprs.propf;
  }

  return result;
}
