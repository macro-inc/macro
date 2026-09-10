import {
  AST,
  type BackendAstMap,
  type BackendAstNode,
  clause,
  compileExpr,
  eq,
  isBackendAstNode,
  type TargetExpr,
} from './clause';
import {
  ENTITY_ID_BACKENDS,
  ENTITY_ID_FIELDS,
  ENTITY_TARGETS,
  type EntityTarget,
  NIL_ID,
  TARGETS,
  type Target,
} from './constants';
import type {
  Facet,
  FacetClause,
  FacetClauseDefinition,
  FacetOption,
  FacetSelection,
} from './types';

export function resolveFacetOption<
  TItem,
  TContext,
  TOption extends FacetOption<TItem, TContext>,
>(
  facet: Facet<TItem, TContext, TOption>,
  optionId: string,
  context: TContext
): TOption | undefined {
  if (typeof facet.options === 'function') {
    return facet.options(optionId, context);
  }
  return facet.options.find((candidate) => candidate.id === optionId);
}

export function resolveFacetMode<TItem, TContext>(
  facet: Facet<TItem, TContext>,
  context: TContext
) {
  if (typeof facet.mode === 'function') return facet.mode(context);
  return facet.mode;
}

const resolveClause = <TContext>(
  definition: FacetClauseDefinition<TContext> | undefined,
  context: TContext
): FacetClause => {
  if (definition === undefined) return {};
  if (typeof definition === 'function') return definition(clause, context);
  return definition;
};

// Excludes unused entity targets with a NIL ID filter.
export const confine = (facetClause: FacetClause): FacetClause => {
  const out: FacetClause = { ...facetClause };
  for (const target of ENTITY_TARGETS) {
    if (!(target in out)) {
      out[target] = eq(ENTITY_ID_FIELDS[target], NIL_ID);
    }
  }
  return out;
};

const isEntityTarget = (target: Target): target is EntityTarget =>
  ENTITY_TARGETS.includes(target as EntityTarget);

// per target: combine each facet's active options by mode, then AND the facets.
// Keep `confine`d NIL leaves inside each facet's expression so OR semantics
// preserve targets admitted by another active option.
export const compileFacets = <
  TItem,
  TContext,
  TOption extends FacetOption<TItem, TContext>,
>(
  selection: FacetSelection,
  facets: Facet<TItem, TContext, TOption>[],
  context: TContext
): BackendAstMap => {
  const byTarget = new Map<Target, BackendAstNode[]>();
  let allowed: Set<EntityTarget> | undefined;

  for (const facet of facets) {
    const activeIds = [...new Set(selection[facet.id] ?? [])].sort();

    if (!activeIds.length) continue;

    const activeOptions = activeIds.flatMap((id) => {
      const option = resolveFacetOption(facet, id, context);
      return option ? [option] : [];
    });
    if (!activeOptions.length) continue;

    const clauses = activeOptions.map((option) =>
      resolveClause(option.clause, context)
    );

    const exprsByTarget = new Map<Target, TargetExpr[]>();
    const facetAllowed = new Set<EntityTarget>();

    for (const clause of clauses) {
      for (const target of Object.keys(clause) as Target[]) {
        if (facet.restrict && isEntityTarget(target)) facetAllowed.add(target);

        const expr = clause[target];
        if (!expr) continue;

        const list = exprsByTarget.get(target) ?? [];
        list.push(expr);
        exprsByTarget.set(target, list);
      }
    }

    if (facet.restrict) {
      allowed =
        allowed === undefined
          ? facetAllowed
          : new Set([...allowed].filter((target) => facetAllowed.has(target)));
    }

    const mode = resolveFacetMode(facet, context);
    for (const [target, exprs] of exprsByTarget) {
      const combined: TargetExpr =
        mode === 'or' ? { or: exprs } : { and: exprs };
      const ast = compileExpr(target, combined);

      if (!ast) continue;

      const list = byTarget.get(target) ?? [];
      list.push(ast);
      byTarget.set(target, list);
    }
  }

  const result: BackendAstMap = {};

  for (const target of TARGETS) {
    const asts = byTarget.get(target);
    if (!asts?.length) continue;

    const combined = AST.and(asts);
    if (isBackendAstNode(combined)) result[target] = combined;
  }

  if (allowed !== undefined) {
    for (const target of ENTITY_TARGETS) {
      if (allowed.has(target)) continue;
      result[target] = {
        l: { [ENTITY_ID_BACKENDS[target]]: NIL_ID },
      };
    }
  }

  return result;
};

export const compileClause = (optionClause: FacetClause): BackendAstMap => {
  const out: BackendAstMap = {};

  for (const target of Object.keys(optionClause) as Target[]) {
    const expr = optionClause[target];
    if (!expr) continue;

    const ast = compileExpr(target, expr);
    if (ast) out[target] = ast;
  }

  return out;
};

export const mergeAst = (a: BackendAstMap, b: BackendAstMap): BackendAstMap => {
  const out: BackendAstMap = { ...a };

  for (const target of Object.keys(b) as Target[]) {
    const incoming = b[target];
    if (!incoming) continue;

    const existing = out[target];
    out[target] = existing ? { '&': [existing, incoming] } : incoming;
  }

  return out;
};
