import { type Accessor, createContext, useContext } from 'solid-js';
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

  // Local editor open state. Populated by EditTrigger when the consumer hasn't
  // supplied an external onEdit; consumed by PopoverEditor. The anchor passed
  // to openEditor is recorded internally by <Property.Root> and used by the
  // Kobalte popper via getAnchorRect — callers don't read it back.
  editorOpen: Accessor<boolean>;
  openEditor: (anchor?: HTMLElement) => void;
  closeEditor: () => void;
}

export const PropertyRootContext = createContext<PropertyRootContextValue>();

export function useProperty(): PropertyRootContextValue {
  const ctx = useContext(PropertyRootContext);
  if (!ctx) {
    throw new Error('useProperty must be used within <Property.Root>');
  }
  return ctx;
}
