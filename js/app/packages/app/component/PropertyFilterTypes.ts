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
  // SELECT_NUMBER | SELECT_STRING - equality/contains (multiple) or comparison (single)
  | {
      propertyId: string;
      dataType: 'SELECT_NUMBER' | 'SELECT_STRING';
      action: EqualityAction | ContainsAction;
      values: string[]; // option ids
    }
  | {
      propertyId: string;
      dataType: 'SELECT_NUMBER' | 'SELECT_STRING';
      action: ComparisonAction;
      value: string; // option id
    }
  // ENTITY - equality or contains (always multiple)
  | {
      propertyId: string;
      dataType: 'ENTITY';
      action: EqualityAction | ContainsAction;
      values: EntityFilterValue[];
    };

/** Helper: Check if a data type is filterable */
export const isFilterableDataType = (dataType: DataType): boolean => {
  return (FILTERABLE_DATA_TYPES as readonly DataType[]).includes(dataType);
};

/** Helper: Get valid actions for a property based on data type and multi-select status */
export const getValidFilterActions = (
  dataType: DataType,
  isMultiSelect: boolean
): FilterAction[] => {
  // Multi-select properties only support contains actions
  if (isMultiSelect) {
    return [
      ContainsAction.HAS_ANY,
      ContainsAction.HAS_ALL,
      ContainsAction.DOES_NOT_HAVE,
    ];
  }

  // Single value properties - actions depend on data type
  switch (dataType) {
    case DataType.BOOLEAN:
    case DataType.ENTITY:
      return [EqualityAction.EQUAL, EqualityAction.NOT_EQUAL];
    case DataType.DATE:
    case DataType.NUMBER:
    case DataType.SELECT_NUMBER:
    case DataType.SELECT_STRING:
      return [
        EqualityAction.EQUAL,
        EqualityAction.NOT_EQUAL,
        ComparisonAction.GREATER_THAN,
        ComparisonAction.GREATER_THAN_OR_EQUAL,
        ComparisonAction.LESS_THAN,
        ComparisonAction.LESS_THAN_OR_EQUAL,
      ];
    default:
      return [];
  }
};
