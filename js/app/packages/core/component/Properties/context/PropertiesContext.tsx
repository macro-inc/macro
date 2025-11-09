import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  createContext,
  createEffect,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { Property } from '../types';

export type ModalType =
  | 'add-property'
  | 'edit-property'
  | 'date-picker'
  | 'create-property';

export interface ModalState {
  type: ModalType | null;
  data: unknown;
  anchor?: HTMLElement | null;
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
  // Modal state
  modalState: () => ModalState;
  openModal: (type: ModalType, data?: unknown, anchor?: HTMLElement) => void;
  closeModal: () => void;
  isModalOpen: (type: ModalType) => boolean;
  getModalData: () => unknown;
  getModalAnchor: () => HTMLElement | null | undefined;
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
  const [modalState, setModalState] = createSignal<ModalState>({
    type: null,
    data: null,
    anchor: null,
  });

  const openModal = (type: ModalType, data?: unknown, anchor?: HTMLElement) => {
    setModalState({ type, data, anchor });
  };

  const closeModal = () => {
    setModalState({ type: null, data: null, anchor: null });
  };

  const isModalOpen = (type: ModalType) => {
    return modalState().type === type;
  };

  const getModalData = () => {
    return modalState().data;
  };

  const getModalAnchor = () => {
    return modalState().anchor;
  };

  // Handle ESC key to close modals
  // Use capture phase listener to intercept before hotkey system (like drawer close)
  createEffect(() => {
    const isModalOpen = modalState().type !== null;

    if (isModalOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && modalState().type !== null) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          closeModal();
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
    // Modal state
    modalState,
    openModal,
    closeModal,
    isModalOpen,
    getModalData,
    getModalAnchor,
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
