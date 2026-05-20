// Re-export domain types from the existing @core/component/Properties package.
// Source of truth lives there for now; a future PR will flip ownership to @property.

export type {
  DateProperty,
  EntityProperty,
  Property,
  PropertyApiValues,
  SelectProperty,
} from '@core/component/Properties/types';
