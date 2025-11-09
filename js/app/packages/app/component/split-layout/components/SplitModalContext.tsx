import { EntityModal } from '@app/component/EntityModal/EntityModal';
import type { EntityData } from '@macro-entity';
import type { ItemType } from '@service-storage/client';
import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

type ModalView = 'rename' | 'moveToProject';

type ModalParams = {
  id: string;
  name: string;
  itemType: ItemType;
  view: ModalView;
  viewId?: string;
  onComplete?: (newValue?: string) => void;
};

const SplitModalContext = createContext<(params: ModalParams) => void>();

export function useSplitModal() {
  const context = useContext(SplitModalContext);
  if (!context) {
    throw new Error('useSplitModal must be used within a SplitModalProvider');
  }
  return context;
}

// Backward compatibility hook
export function useRenameSplit() {
  const modal = useSplitModal();
  return (params: {
    id: string;
    currentName: string;
    itemType: ItemType;
    onRename?: (newName: string) => void;
  }) => {
    modal({
      id: params.id,
      name: params.currentName,
      itemType: params.itemType,
      view: 'rename',
      onComplete: params.onRename,
    });
  };
}

// Helper to convert ItemType to EntityData type
const itemTypeToEntityType = (itemType: ItemType): EntityData['type'] => {
  switch (itemType) {
    case 'document':
      return 'document';
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    default:
      return 'document'; // fallback
  }
};

export function SplitModalProvider(props: ParentProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [currentView, setCurrentView] = createSignal<ModalView | null>(null);
  const [modalParams, setModalParams] = createSignal<ModalParams | null>(null);

  const openModal = (params: ModalParams) => {
    setModalParams(params);
    setCurrentView(params.view);
    setIsOpen(true);
  };

  const createEntityData = (): EntityData | undefined => {
    const params = modalParams();
    if (!params) return undefined;

    const baseEntity = {
      id: params.id,
      name: params.name,
      ownerId: '', // This would need to be filled from context
      type: itemTypeToEntityType(params.itemType),
    };

    switch (params.itemType) {
      case 'document':
        return {
          ...baseEntity,
          type: 'document',
          projectId: undefined, // Could be extracted from context if needed
        } as EntityData;
      case 'chat':
        return {
          ...baseEntity,
          type: 'chat',
          projectId: undefined,
        } as EntityData;
      case 'project':
        return {
          ...baseEntity,
          type: 'project',
          parentId: undefined,
        } as EntityData;
      default:
        return {
          ...baseEntity,
          type: 'document',
        } as EntityData;
    }
  };

  return (
    <SplitModalContext.Provider value={openModal}>
      {props.children}
      <EntityModal
        isOpen={() => isOpen()}
        setIsOpen={setIsOpen}
        view={() => currentView() || 'rename'}
        entity={createEntityData()}
        viewId={modalParams()?.viewId}
      />
    </SplitModalContext.Provider>
  );
}
