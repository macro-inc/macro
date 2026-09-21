import type { DatabaseEntityType } from './column-inference';

/** Explicit changes are validated against every stored value by the server. */
export type DatabaseColumnTypeChange = {
  dataType:
    | 'STRING'
    | 'NUMBER'
    | 'BOOLEAN'
    | 'DATE'
    | 'SELECT_STRING'
    | 'LINK'
    | 'ENTITY';
  isMultiSelect?: boolean;
  specificEntityType?: DatabaseEntityType;
  linkToTableId?: string;
};
