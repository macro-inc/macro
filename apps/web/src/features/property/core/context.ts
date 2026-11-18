import { type Accessor, createContext, useContext } from 'solid-js';
import type { Property, PropertyApiValues } from '../types';

export type PropertySaveFn = (
  property: Property,
  value: PropertyApiValues
) => Promise<void>;

/**
 * Saves a pick. An entity editor also passes the names its picker showed, by
 * entity ID, so the pick can be named before the entity's own read loads.
 */
export type PropertyPickFn = (
  property: Property,
  value: PropertyApiValues,
  entityNames?: ReadonlyMap<string, string>
) => Promise<void>;

export type PropertyEditFn = (property: Property, anchor?: HTMLElement) => void;

export interface PropertyRootContextValue {
  /** The property as shown: a pick still saving replaces the source value. */
  property: () => Property;
  /** The name the picker showed for an entity in the pick being shown. */
  pickedEntityName: (entityId: string) => string | undefined;
  canEdit: () => boolean;
  /** Saves through the consumer's handler and shows the pick until then. */
  onSave?: PropertyPickFn;
  onEdit?: PropertyEditFn;

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
