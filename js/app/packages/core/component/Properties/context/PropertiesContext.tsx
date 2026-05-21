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
import type { Property, PropertyApiValues } from '../types';

// Specific modal state types with proper typing
interface PropertySelectorModalState {
  isOpen: boolean;
}

interface DatePickerModalState {
  property: Property & { valueType: 'DATE' };
  anchor?: HTMLElement;
}

interface CreatePropertyModalState {
  isOpen: boolean;
  autoPinOnCreate?: boolean;
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
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];
  saveHandler: PropertySaveHandler;

  // Specific modal state accessors
  propertySelectorModal: Accessor<PropertySelectorModalState | null>;
  datePickerModal: Accessor<DatePickerModalState | null>;
  createPropertyModal: Accessor<CreatePropertyModalState | null>;

  // Specific modal actions
  openPropertySelector: () => void;
  closePropertySelector: () => void;

  openDatePicker: (
    property: Property & { valueType: 'DATE' },
    anchor?: HTMLElement
  ) => void;
  closeDatePicker: () => void;

  openCreateProperty: (autoPinOnCreate?: boolean) => void;
  closeCreateProperty: () => void;

  // Convenience function to close all modals
  closeAllModals: () => void;
}

interface PropertiesProviderProps extends ParentProps {
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  properties: () => Property[];
  onRefresh: () => void;
  onPropertyAdded: (addedDefinitionIds?: string[]) => void;
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];
  saveHandler: PropertySaveHandler;
}

const PropertiesContext = createContext<PropertiesContextValue>();

export function PropertiesProvider(props: PropertiesProviderProps) {
  // Modal state signals
  const [propertySelectorModal, setPropertySelectorModal] =
    createSignal<PropertySelectorModalState | null>(null);
  const [datePickerModal, setDatePickerModal] =
    createSignal<DatePickerModalState | null>(null);
  const [createPropertyModal, setCreatePropertyModal] =
    createSignal<CreatePropertyModalState | null>(null);

  // Property Selector actions
  const openPropertySelector = () => {
    setPropertySelectorModal({ isOpen: true });
  };

  const closePropertySelector = () => {
    setPropertySelectorModal(null);
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
  const openCreateProperty = (autoPinOnCreate?: boolean) => {
    setCreatePropertyModal({ isOpen: true, autoPinOnCreate });
  };

  const closeCreateProperty = () => {
    setCreatePropertyModal(null);
  };

  // Convenience function to close all modals
  const closeAllModals = () => {
    setPropertySelectorModal(null);
    setDatePickerModal(null);
    setCreatePropertyModal(null);
  };

  // Handle ESC key to close modals
  // Use capture phase listener to intercept before hotkey system's capture phase handlers
  createEffect(() => {
    const isAnyModalOpen =
      propertySelectorModal() !== null ||
      datePickerModal() !== null ||
      createPropertyModal() !== null;

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
    entityType: props.entityType,
    canEdit: props.canEdit,
    documentName: props.documentName,
    properties: props.properties,
    onRefresh: props.onRefresh,
    onPropertyAdded: props.onPropertyAdded,
    onPropertyDeleted: props.onPropertyDeleted,
    onPropertyPinned: props.onPropertyPinned,
    onPropertyUnpinned: props.onPropertyUnpinned,
    pinnedPropertyIds: props.pinnedPropertyIds,
    saveHandler: props.saveHandler,
    // Specific modal state
    propertySelectorModal,
    datePickerModal,
    createPropertyModal,
    // Specific modal actions
    openPropertySelector,
    closePropertySelector,
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
