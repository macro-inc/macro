import { DataType } from '@service-properties/generated/schemas/dataType';
import type { EntityType } from '@service-properties/generated/schemas/entityType';

// ============================================
// Property Filter Models
// ============================================

/** Data types that support filtering */
export const FILTERABLE_DATA_TYPES = [
  DataType.BOOLEAN,
  DataType.DATE,
  DataType.NUMBER,
  DataType.SELECT_NUMBER,
  DataType.SELECT_STRING,
  DataType.ENTITY,
] as const;

/** Equality actions - matches against one or more values (OR logic for multiple) */
export const EqualityAction = {
  EQUAL: 'equal',
  NOT_EQUAL: 'not_equal',
} as const;
export type EqualityAction =
  (typeof EqualityAction)[keyof typeof EqualityAction];

/** Comparison actions - available for DATE, NUMBER, SELECT_NUMBER, SELECT_STRING (single value only) */
export const ComparisonAction = {
  GREATER_THAN: 'greater_than',
  GREATER_THAN_OR_EQUAL: 'greater_than_or_equal',
  LESS_THAN: 'less_than',
  LESS_THAN_OR_EQUAL: 'less_than_or_equal',
} as const;
export type ComparisonAction =
  (typeof ComparisonAction)[keyof typeof ComparisonAction];

/** Contains actions - available for multi-value properties (SELECT_NUMBER, SELECT_STRING, ENTITY) */
export const ContainsAction = {
  HAS_ANY: 'has_any',
  HAS_ALL: 'has_all',
  DOES_NOT_HAVE: 'does_not_have',
} as const;
export type ContainsAction =
  (typeof ContainsAction)[keyof typeof ContainsAction];

/** All possible filter actions */
export type FilterAction = EqualityAction | ComparisonAction | ContainsAction;

/** Symbols for filter actions (shown in pill) */
export const ACTION_SYMBOLS: Record<FilterAction, string> = {
  [EqualityAction.EQUAL]: '=',
  [EqualityAction.NOT_EQUAL]: '≠',
  [ComparisonAction.GREATER_THAN]: '>',
  [ComparisonAction.GREATER_THAN_OR_EQUAL]: '≥',
  [ComparisonAction.LESS_THAN]: '<',
  [ComparisonAction.LESS_THAN_OR_EQUAL]: '≤',
  [ContainsAction.HAS_ANY]: '∈',
  [ContainsAction.HAS_ALL]: '⊇',
  [ContainsAction.DOES_NOT_HAVE]: '∉',
};

/** Display names for filter actions (shown in dropdown: text + symbol) */
export const ACTION_DISPLAY_NAMES: Record<FilterAction, string> = {
  [EqualityAction.EQUAL]: 'is =',
  [EqualityAction.NOT_EQUAL]: 'is not ≠',
  [ComparisonAction.GREATER_THAN]: 'greater than >',
  [ComparisonAction.GREATER_THAN_OR_EQUAL]: 'at least ≥',
  [ComparisonAction.LESS_THAN]: 'less than <',
  [ComparisonAction.LESS_THAN_OR_EQUAL]: 'at most ≤',
  [ContainsAction.HAS_ANY]: 'has any ∈',
  [ContainsAction.HAS_ALL]: 'has all ⊇',
  [ContainsAction.DOES_NOT_HAVE]: 'has none ∉',
};

/** Entity reference for ENTITY filter values */
export type EntityFilterValue = {
  entityType: EntityType;
  entityId: string;
};

/** Property filter - discriminated union by dataType */
export type PropertyFilter =
  // BOOLEAN - equality only (single value)
  | {
      propertyId: string;
      dataType: 'BOOLEAN';
      action: EqualityAction;
      value: boolean;
    }
  // DATE - equality (multiple) or comparison (single)
  | {
      propertyId: string;
      dataType: 'DATE';
      action: EqualityAction;
      values: string[]; // ISO date strings
    }
  | {
      propertyId: string;
      dataType: 'DATE';
      action: ComparisonAction;
      value: string; // ISO date string
    }
  // NUMBER - equality (multiple) or comparison (single)
  | {
      propertyId: string;
      dataType: 'NUMBER';
      action: EqualityAction;
      values: number[];
    }
  | {
      propertyId: string;
      dataType: 'NUMBER';
      action: ComparisonAction;
      value: number;
    }
  // SELECT_NUMBER | SELECT_STRING (single-value) - equality or comparison
  | {
      propertyId: string;
      dataType: 'SELECT_NUMBER' | 'SELECT_STRING';
      action: EqualityAction;
      values: string[]; // option ids
    }
  | {
      propertyId: string;
      dataType: 'SELECT_NUMBER' | 'SELECT_STRING';
      action: ComparisonAction;
      value: string; // option id
    }
  // SELECT_NUMBER | SELECT_STRING (multi-value) - contains only
  | {
      propertyId: string;
      dataType: 'SELECT_NUMBER' | 'SELECT_STRING';
      action: ContainsAction;
      values: string[]; // option ids
    }
  // ENTITY (single-value) - equality only
  | {
      propertyId: string;
      dataType: 'ENTITY';
      action: EqualityAction;
      values: EntityFilterValue[];
    }
  // ENTITY (multi-value) - contains only
  | {
      propertyId: string;
      dataType: 'ENTITY';
      action: ContainsAction;
      values: EntityFilterValue[];
    };

/** Helper: Check if a data type is filterable */
export const isFilterableDataType = (dataType: DataType): boolean => {
  return (FILTERABLE_DATA_TYPES as readonly DataType[]).includes(dataType);
};

/** Helper: Get valid filter actions for a property based on data type and multi-select */
export const getValidFilterActions = (
  dataType: DataType,
  isMultiSelect: boolean
): FilterAction[] => {
  const actions: FilterAction[] = [];

  // Multi-select properties only support contains actions
  if (isMultiSelect) {
    actions.push(ContainsAction.HAS_ANY);
    actions.push(ContainsAction.HAS_ALL);
    actions.push(ContainsAction.DOES_NOT_HAVE);
    return actions;
  }

  // BOOLEAN: only equality
  if (dataType === DataType.BOOLEAN) {
    return [EqualityAction.EQUAL, EqualityAction.NOT_EQUAL];
  }

  // ENTITY (single-value): only equality
  if (dataType === DataType.ENTITY) {
    return [EqualityAction.EQUAL, EqualityAction.NOT_EQUAL];
  }

  // DATE, NUMBER, SELECT_NUMBER, SELECT_STRING: equality + comparison
  actions.push(EqualityAction.EQUAL);
  actions.push(EqualityAction.NOT_EQUAL);
  actions.push(ComparisonAction.GREATER_THAN);
  actions.push(ComparisonAction.GREATER_THAN_OR_EQUAL);
  actions.push(ComparisonAction.LESS_THAN);
  actions.push(ComparisonAction.LESS_THAN_OR_EQUAL);

  return actions;
};

/** Helper: Check if a new filter conflicts with existing filters */
export const checkFilterConflict = (
  newFilter: PropertyFilter,
  existingFilters: PropertyFilter[]
): string | null => {
  const filtersForProperty = existingFilters.filter(
    (f) => f.propertyId === newFilter.propertyId
  );

  if (filtersForProperty.length === 0) return null;

  const existingActions = new Set(filtersForProperty.map((f) => f.action));
  const newAction = newFilter.action;

  // BOOLEAN: only one filter allowed per property
  if (newFilter.dataType === 'BOOLEAN' && filtersForProperty.length > 0) {
    return 'Redundant: boolean already filtered';
  }

  // Duplicate action (except has_any which can be repeated)
  if (existingActions.has(newAction) && newAction !== ContainsAction.HAS_ANY) {
    return `Redundant: duplicate "${ACTION_DISPLAY_NAMES[newAction]}" filter`;
  }

  // Equal conflicts with comparisons
  if (newAction === EqualityAction.EQUAL) {
    const hasComparison =
      existingActions.has(ComparisonAction.GREATER_THAN) ||
      existingActions.has(ComparisonAction.GREATER_THAN_OR_EQUAL) ||
      existingActions.has(ComparisonAction.LESS_THAN) ||
      existingActions.has(ComparisonAction.LESS_THAN_OR_EQUAL);
    if (hasComparison) {
      return 'Conflicting: "is" + comparison';
    }
  }

  // Comparisons conflict with equal
  const isComparison =
    newAction === ComparisonAction.GREATER_THAN ||
    newAction === ComparisonAction.GREATER_THAN_OR_EQUAL ||
    newAction === ComparisonAction.LESS_THAN ||
    newAction === ComparisonAction.LESS_THAN_OR_EQUAL;
  if (isComparison && existingActions.has(EqualityAction.EQUAL)) {
    return 'Conflicting: comparison + "is"';
  }

  // Lower bound conflicts
  const isLowerBound =
    newAction === ComparisonAction.GREATER_THAN ||
    newAction === ComparisonAction.GREATER_THAN_OR_EQUAL;
  const hasLowerBound =
    existingActions.has(ComparisonAction.GREATER_THAN) ||
    existingActions.has(ComparisonAction.GREATER_THAN_OR_EQUAL);
  if (isLowerBound && hasLowerBound) {
    return 'Redundant: multiple lower bounds';
  }

  // Upper bound conflicts
  const isUpperBound =
    newAction === ComparisonAction.LESS_THAN ||
    newAction === ComparisonAction.LESS_THAN_OR_EQUAL;
  const hasUpperBound =
    existingActions.has(ComparisonAction.LESS_THAN) ||
    existingActions.has(ComparisonAction.LESS_THAN_OR_EQUAL);
  if (isUpperBound && hasUpperBound) {
    return 'Redundant: multiple upper bounds';
  }

  return null;
};
