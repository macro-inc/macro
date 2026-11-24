import type { Property, PropertyApiValues } from '@property/types';

/** Preserve the shared property's discriminant when previewing an unsaved value. */
export function withProjectPropertyValue(
  property: Property,
  value?: PropertyApiValues
): Property {
  if (!value) return property;
  if (
    property.valueType === 'SELECT_STRING' &&
    value.valueType === 'SELECT_STRING'
  )
    return { ...property, value: value.values };
  if (property.valueType === 'ENTITY' && value.valueType === 'ENTITY')
    return { ...property, value: value.refs };
  if (property.valueType === 'DATE' && value.valueType === 'DATE') {
    const { hasTime: _previous, ...day } = property;
    return value.hasTime
      ? { ...day, value: value.value, hasTime: true }
      : { ...day, value: value.value };
  }
  return property;
}
