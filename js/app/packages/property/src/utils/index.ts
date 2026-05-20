// Re-export the utilities the @property primitives consume.
// Source of truth still lives under @core/component/Properties/utils;
// a future consolidation PR will move ownership here.

export {
  extractDomain,
  formatBoolean,
  formatDate,
  formatNumber,
  formatOptionValue,
  formatPropertyValue,
} from '@core/component/Properties/utils/formatting';

export {
  getEntityValues,
  getLinkValues,
  getSelectValues,
  hasValue,
  isBooleanProperty,
  isDateProperty,
  isEntityProperty,
  isLinkProperty,
  isNumberProperty,
  isSelectProperty,
  isStringProperty,
  toPropertyApiValue,
} from '@core/component/Properties/utils/typeGuards';
