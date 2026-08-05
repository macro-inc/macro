import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';
import { openPropertyEditor } from '../editor/state/propertyEditor';
import type { Property, PropertyApiValues } from '../types';

interface DatePickerModalState {
  property: Property & { valueType: 'DATE' };
  anchor?: HTMLElement;
}

interface CreatePropertyModalState {
  isOpen: boolean;
  autoPinOnCreate?: boolean;
  initialName?: string;
}

export interface PropertySaveHandler {
  saveProperty: (property: Property, value: PropertyApiValues) => Promise<void>;
  saveDate: (property: Property, date: Date) => Promise<void>;
}

interface PropertiesContextValue {
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  properties: () => Property[];
  onRefresh: () => void;
  onPropertyAdded: (addedDefinitionIds?: string[]) => void;
  onPropertyAddFailed?: (definitionId: string) => void;
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];
  addProperty?: (propertyDefinitionId: string) => Promise<void>;
  removeProperty?: (propertyId: string) => Promise<void>;
  saveHandler: PropertySaveHandler;

  // Specific modal state accessors
  datePickerModal: Accessor<DatePickerModalState | null>;
  createPropertyModal: Accessor<CreatePropertyModalState | null>;

  // Specific modal actions
  openPropertySelector: () => void;

  openDatePicker: (
    property: Property & { valueType: 'DATE' },
    anchor?: HTMLElement
  ) => void;
  closeDatePicker: () => void;

  openCreateProperty: (autoPinOnCreate?: boolean, initialName?: string) => void;
  closeCreateProperty: () => void;

  // Convenience function to close all modals
  closeAllModals: () => void;
}

interface PropertiesProviderProps extends ParentProps {
  entityId?: string;
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  properties: () => Property[];
  onRefresh: () => void;
  onPropertyAdded: (addedDefinitionIds?: string[]) => void;
  onPropertyAddFailed?: (definitionId: string) => void;
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];
  addProperty?: (propertyDefinitionId: string) => Promise<void>;
  removeProperty?: (propertyId: string) => Promise<void>;
  saveHandler: PropertySaveHandler;
}

const PropertiesContext = createContext<PropertiesContextValue>();

export function PropertiesProvider(props: PropertiesProviderProps) {
  // Modal state signals
  const [datePickerModal, setDatePickerModal] =
    createSignal<DatePickerModalState | null>(null);
  const [createPropertyModal, setCreatePropertyModal] =
    createSignal<CreatePropertyModalState | null>(null);

  // Property Selector actions
  const openPropertySelector = () => {
    if (!props.canEdit) return;
    if (!props.entityId) return;
    openPropertyEditor(
      [
        {
          id: props.entityId,
          name: props.documentName ?? 'Entity',
          entityType: props.entityType,
        },
      ],
      'selector',
      undefined,
      {
        onPropertyAdded: async (definitionIds) => {
          if (!definitionIds?.length) {
            props.onPropertyAdded();
            return;
          }

          for (const definitionId of definitionIds) {
            const existingProperty = props
              .properties()
              .find(
                (property) => property.propertyDefinitionId === definitionId
              );

            if (existingProperty) {
              props.onPropertyPinned?.(existingProperty.propertyId);
              continue;
            }

            props.onPropertyAdded([definitionId]);
            try {
              await props.addProperty?.(definitionId);
              props.onPropertyAdded([definitionId]);
            } catch (error) {
              props.onPropertyAddFailed?.(definitionId);
              console.error('Failed to add property to entity', error);
            }
          }
        },
      }
    );
  };

  // Date Picker actions
  const openDatePicker = (
    property: Property & { valueType: 'DATE' },
    anchor?: HTMLElement
  ) => {
    setDatePickerModal({ property, anchor });
  };

  const closeDatePicker = () => {
    setDatePickerModal(null);
  };

  // Create Property actions
  const openCreateProperty = (
    autoPinOnCreate?: boolean,
    initialName?: string
  ) => {
    setCreatePropertyModal({ isOpen: true, autoPinOnCreate, initialName });
  };

  const closeCreateProperty = () => {
    setCreatePropertyModal(null);
  };

  // Convenience function to close all modals
  const closeAllModals = () => {
    setDatePickerModal(null);
    setCreatePropertyModal(null);
  };

  // Handle ESC key to close modals
  // Use capture phase listener to intercept before hotkey system's capture phase handlers
  createEffect(() => {
    const isAnyModalOpen =
      datePickerModal() !== null || createPropertyModal() !== null;

    let handleKeyDown: (e: KeyboardEvent) => void;

    if (isAnyModalOpen) {
      handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeAllModals();
        }
      };

      document.addEventListener('keydown', handleKeyDown, { capture: true });
    }
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      });
    });
  });

  const value: PropertiesContextValue = {
    get entityType() {
      return props.entityType;
    },
    get canEdit() {
      return props.canEdit;
    },
    get documentName() {
      return props.documentName;
    },
    properties: props.properties,
    onRefresh: props.onRefresh,
    onPropertyAdded: props.onPropertyAdded,
    onPropertyAddFailed: props.onPropertyAddFailed,
    onPropertyDeleted: props.onPropertyDeleted,
    onPropertyPinned: props.onPropertyPinned,
    onPropertyUnpinned: props.onPropertyUnpinned,
    pinnedPropertyIds: props.pinnedPropertyIds,
    addProperty: props.addProperty,
    removeProperty: props.removeProperty,
    saveHandler: props.saveHandler,
    // Specific modal state
    datePickerModal,
    createPropertyModal,
    // Specific modal actions
    openPropertySelector,
    openDatePicker,
    closeDatePicker,
    openCreateProperty,
    closeCreateProperty,
    closeAllModals,
  };

  return (
    <PropertiesContext.Provider value={value}>
      {props.children}
    </PropertiesContext.Provider>
  );
}

export function usePropertiesContext() {
  const context = useContext(PropertiesContext);
  if (!context) {
    throw new Error(
      'usePropertiesContext must be used within PropertiesProvider'
    );
  }
  return context;
}

export function useMaybePropertiesContext() {
  return useContext(PropertiesContext);
}
