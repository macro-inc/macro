import { createContext, useContext } from 'solid-js';
import type { Property, PropertyApiValues } from '../types';

export type PropertySaveFn = (
  property: Property,
  value: PropertyApiValues
) => Promise<void>;

export type PropertyEditFn = (property: Property, anchor?: HTMLElement) => void;

export interface PropertyRootContextValue {
  property: () => Property;
  canEdit: () => boolean;
  onSave?: PropertySaveFn;
  onEdit?: PropertyEditFn;
  onRefresh?: () => void;
}

export const PropertyRootContext = createContext<PropertyRootContextValue>();

export function useProperty(): PropertyRootContextValue {
  const ctx = useContext(PropertyRootContext);
  if (!ctx) {
    throw new Error('useProperty must be used within <Property.Root>');
  }
  return ctx;
}

export function useMaybeProperty(): PropertyRootContextValue | undefined {
  return useContext(PropertyRootContext);
}
