import type { EditMethod, ValueType } from '../types';

/**
 * Get the edit method for a property value type
 */
export function getEditMethod(valueType: ValueType): EditMethod {
  switch (valueType) {
    case 'STRING':
    case 'NUMBER':
      return 'inline';

    case 'BOOLEAN':
      return 'inline'; // Toggle is a form of inline editing

    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
    case 'ENTITY':
      return 'multi';

    case 'DATE':
      return 'modal';

    case 'LINK':
      return 'inline';

    default:
      return 'no_edit';
  }
}
