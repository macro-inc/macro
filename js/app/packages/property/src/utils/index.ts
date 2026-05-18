// Re-export the utilities the @property primitives consume.
// Source of truth still lives under @core/component/Properties/utils;
// a future consolidation PR will move ownership here.

export {
  extractDomain,
  formatBoolean,
  formatDate,
  formatNumber,
  formatOptionValue,
  formatOptionValueById,
  formatPropertyValue,
  getOptionValue,
} from '@core/component/Properties/utils/formatting';

export {
  getEntityValues,
  getLinkValues,
  getSelectValues,
  hasMultiValue,
  hasSingleValue,
  hasValue,
  isBooleanProperty,
  isDateProperty,
  isEntityProperty,
  isLinkProperty,
  isMultiValueProperty,
  isNumberProperty,
  isSelectNumberProperty,
  isSelectProperty,
  isSelectStringProperty,
  isSingleValueProperty,
  isStringProperty,
  toPropertyApiValue,
} from '@core/component/Properties/utils/typeGuards';
