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

  // Closest `.portal-scope` ancestor at the time Property.Root mounted.
  // Used by PopoverEditor to mount the dropdown into the same stacking
  // context as the surrounding panel/dialog instead of document.body —
  // otherwise the editor renders behind a host modal. Undefined until the
  // root div mounts, after which Kobalte's Portal falls back to body.
  portalMount: Accessor<HTMLElement | undefined>;
}

export const PropertyRootContext = createContext<PropertyRootContextValue>();

export function useProperty(): PropertyRootContextValue {
  const ctx = useContext(PropertyRootContext);
  if (!ctx) {
    throw new Error('useProperty must be used within <Property.Root>');
  }
  return ctx;
}
