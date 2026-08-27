import type { Accessor } from 'solid-js';
import type { TargetExpr } from './clause';
import type { Target } from './constants';

/** Canonical persisted facet intent. Unknown string IDs are preserved. */
export type FacetSelection = Record<string, string[]>;

export type FacetMode<TContext = unknown> =
  | 'and'
  | 'or'
  | ((context: TContext) => 'and' | 'or');

export type FacetPredicate<TItem, TContext> = (
  item: TItem,
  context: TContext
) => boolean;

export type FacetClause = Partial<Record<Target, TargetExpr>>;

export type FacetClauseBuilder = {
  eq: (field: string, value: unknown) => TargetExpr;
  not: (expression: TargetExpr) => TargetExpr;
  and: (...expressions: TargetExpr[]) => TargetExpr;
  or: (...expressions: TargetExpr[]) => TargetExpr;
};

export type FacetClauseDefinition<TContext> =
  | FacetClause
  | ((builder: FacetClauseBuilder, context: TContext) => FacetClause);

export type FacetOption<TItem = unknown, TContext = unknown> = {
  id: string;
  clause?: FacetClauseDefinition<TContext>;
  predicate?: FacetPredicate<TItem, TContext>;
};

export type FacetOptionResolver<
  TItem,
  TContext,
  TOption extends FacetOption<TItem, TContext>,
> = (optionId: string, context: TContext) => TOption | undefined;

export type Facet<
  TItem = unknown,
  TContext = unknown,
  TOption extends FacetOption<TItem, TContext> = FacetOption<TItem, TContext>,
> = {
  id: string;
  mode: FacetMode<TContext>;
  multiple?: boolean;
  /** Constrains unrepresented entity targets with NIL filters. */
  restrict?: boolean;
  options: TOption[] | FacetOptionResolver<TItem, TContext, TOption>;
};

export type FacetSelectionState = {
  selection: Accessor<FacetSelection>;
  has: (facetId: string, optionId: string) => boolean;
  get: (facetId: string) => string[];
  select: (facetId: string, optionId: string) => void;
  deselect: (facetId: string, optionId: string) => void;
  toggle: (facetId: string, optionId: string) => void;
  set: (facetId: string, optionIds: Iterable<string>) => void;
  replace: (selection: FacetSelection) => void;
  clear: (facetId?: string) => void;
};
