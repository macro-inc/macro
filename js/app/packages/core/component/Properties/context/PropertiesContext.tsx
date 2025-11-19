import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type Accessor,
  createContext,
  createEffect,
  type ParentProps,
  useContext,
} from 'solid-js';
import { useModalState } from '../hooks/useModalState';
import type { Property } from '../types';

// Specific modal state types with proper typing
export interface PropertySelectorModalState {
  isOpen: boolean;
}

export interface PropertyEditorModalState {
  property: Property;
  anchor?: HTMLElement;
}

export interface DatePickerModalState {
  property: Property & { valueType: 'DATE' };
  anchor?: HTMLElement;
}

export interface CreatePropertyModalState {
  isOpen: boolean;
}

export interface PropertiesContextValue {
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  properties: () => Property[];
  onRefresh: () => void;
  onPropertyAdded: () => void;
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];

  // Specific modal state accessors
  propertySelectorModal: Accessor<PropertySelectorModalState | null>;
  propertyEditorModal: Accessor<PropertyEditorModalState | null>;
  datePickerModal: Accessor<DatePickerModalState | null>;
  createPropertyModal: Accessor<CreatePropertyModalState | null>;

  // Specific modal actions
  openPropertySelector: () => void;
  closePropertySelector: () => void;

  openPropertyEditor: (property: Property, anchor?: HTMLElement) => void;
  closePropertyEditor: () => void;

  openDatePicker: (
    property: Property & { valueType: 'DATE' },
    anchor?: HTMLElement
  ) => void;
  closeDatePicker: () => void;

  openCreateProperty: () => void;
  closeCreateProperty: () => void;

  // Convenience function to close all modals
  closeAllModals: () => void;
}

export interface PropertiesProviderProps extends ParentProps {
  entityType: EntityType;
  canEdit: boolean;
  documentName?: string;
  properties: () => Property[];
  onRefresh: () => void;
  onPropertyAdded: () => void;
  onPropertyDeleted: () => void;
  onPropertyPinned?: (propertyId: string) => void;
  onPropertyUnpinned?: (propertyId: string) => void;
  pinnedPropertyIds?: () => string[];
}

const PropertiesContext = createContext<PropertiesContextValue>();

export function PropertiesProvider(props: PropertiesProviderProps) {
  // Modal states using generic hook
  const [propertySelectorModal, openPropertySelectorState, closePropertySelector] =
    useModalState<PropertySelectorModalState>();
  const [propertyEditorModal, openPropertyEditorState, closePropertyEditor] =
    useModalState<PropertyEditorModalState>();
  const [datePickerModal, openDatePickerState, closeDatePicker] =
    useModalState<DatePickerModalState>();
  const [createPropertyModal, openCreatePropertyState, closeCreateProperty] =
    useModalState<CreatePropertyModalState>();

  // Property Selector actions
  const openPropertySelector = () => {
    openPropertySelectorState({ isOpen: true });
  };

  // Property Editor actions
  const openPropertyEditor = (property: Property, anchor?: HTMLElement) => {
    openPropertyEditorState({ property, anchor });
  };

  // Date Picker actions
  const openDatePicker = (
    property: Property & { valueType: 'DATE' },
    anchor?: HTMLElement
  ) => {
    openDatePickerState({ property, anchor });
  };

  // Create Property actions
  const openCreateProperty = () => {
    openCreatePropertyState({ isOpen: true });
  };

  // Convenience function to close all modals
  const closeAllModals = () => {
    closePropertySelector();
    closePropertyEditor();
    closeDatePicker();
    closeCreateProperty();
  };

  // Handle ESC key to close modals
  // Use capture phase listener to intercept before hotkey system (like drawer close)
  createEffect(() => {
    const isAnyModalOpen =
      propertySelectorModal() !== null ||
      propertyEditorModal() !== null ||
      datePickerModal() !== null ||
      createPropertyModal() !== null;

    if (isAnyModalOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          closeAllModals();
        }
      };

      // Capture phase = runs before hotkey system's bubble phase handlers
      document.addEventListener('keydown', handleKeyDown, { capture: true });

      // Cleanup when modal closes or component unmounts
      return () => {
        document.removeEventListener('keydown', handleKeyDown, {
          capture: true,
        });
      };
    }
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
    // Specific modal state
    propertySelectorModal,
    propertyEditorModal,
    datePickerModal,
    createPropertyModal,
    // Specific modal actions
    openPropertySelector,
    closePropertySelector,
    openPropertyEditor,
    closePropertyEditor,
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
