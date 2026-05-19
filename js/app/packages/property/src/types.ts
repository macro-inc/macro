// Re-export domain types from the existing @core/component/Properties package.
// Source of truth lives there for now; a future PR will flip ownership to @property.

export type {

  BooleanProperty,

  DateProperty,

  EntityProperty,
  EntityPropertyWithDefinition,
  EntityReference,
  LinkProperty,
  MultiValueProperty,
  NumberProperty,
  PropertiesPanelProps,
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,

  PropertyEditorProps,
  PropertyOption,
  PropertyOptionValue,
  PropertySelectorProps,

  Result,
  SelectNumberProperty,
  SelectProperty,
  SelectStringProperty,
  SetPropertyValue,
  SingleValueProperty,
  StringProperty,
  ValueType,
} from '@core/component/Properties/types';
