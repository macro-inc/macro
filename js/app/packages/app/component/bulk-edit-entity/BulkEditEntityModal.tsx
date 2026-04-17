import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { DialogWrapper } from '@core/component/DialogWrapper';
import { Dialog } from '@kobalte/core/dialog';
import type { EntityData } from '@entity';
import {
  type Accessor,
  createSignal,
  type ParentComponent,
  type Setter,
  Show,
} from 'solid-js';
import { BulkDeleteView } from './BulkDeleteView';
import { BulkMoveToProjectView } from './BulkMoveToProjectView';
import { BulkRenameEntitiesView } from './BulkRenameEntitiesView';

const BulkEditEntityModalContent = (props: {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: 'rename' | 'moveToProject' | 'delete' | null;
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
}) => {
  const handleFinish = () => {
    props.setIsOpen(false);
    props.onFinish?.();
  };
  const handleCancel = () => {
    props.setIsOpen(false);
    props.onCancel?.();
  };

  return (
    <Dialog
      open={props.isOpen()}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel();
        }
        props.setIsOpen(open);
      }}
      modal={true}
    >
      <Dialog.Portal>
        <DialogWrapper>
          <div class="flex flex-col text-ink">
            <Show when={props.view === 'rename'}>
              <BulkRenameEntitiesView
                entities={props.entities}
                onFinish={handleFinish}
                onCancel={handleCancel}
              />
            </Show>
            <Show when={props.view === 'moveToProject'}>
              <BulkMoveToProjectView
                entities={props.entities}
                onFinish={handleFinish}
                onCancel={handleCancel}
              />
            </Show>
            <Show when={props.view === 'delete'}>
              <BulkDeleteView
                entities={props.entities}
                onFinish={handleFinish}
                onCancel={handleCancel}
              />
            </Show>
          </div>
        </DialogWrapper>
      </Dialog.Portal>
    </Dialog>
  );
};

export type BulkEditEntityModalProps = {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: 'rename' | 'moveToProject' | 'delete';
  entities: Accessor<EntityData[]>;
};

export const BulkEditEntityModal: ParentComponent<BulkEditEntityModalProps> = (
  props
) => {
  return (
    <Show when={props.isOpen()}>
      <BulkEditEntityModalContent
        isOpen={props.isOpen}
        setIsOpen={props.setIsOpen}
        view={props.view}
        entities={props.entities()}
      />
    </Show>
  );
};

const [globalModalProps, setGlobalModalProps] = createSignal<{
  view: 'rename' | 'moveToProject' | 'delete';
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
} | null>(null);
const [modalOpen, setModalOpen] = createControlledOpenSignal(false, {
  id: 'entity-edit',
});

export const openBulkEditModal = (props: {
  view: 'rename' | 'moveToProject' | 'delete';
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
}) => {
  setModalOpen(true);
  setGlobalModalProps(props);
};

export const GlobalBulkEditEntityModal = () => {
  const modalProps = () => globalModalProps();

  const handleFinish = () => {
    const props = globalModalProps();
    setGlobalModalProps(null);
    if (props?.onFinish) {
      props.onFinish();
    }
  };

  const handleCancel = () => {
    const props = globalModalProps();
    setGlobalModalProps(null);
    if (props?.onCancel) {
      props.onCancel();
    }
  };

  return (
    <Show when={modalProps()}>
      {(props) => (
        <BulkEditEntityModalContent
          isOpen={modalOpen}
          setIsOpen={setModalOpen}
          view={props().view}
          entities={props().entities}
          onFinish={handleFinish}
          onCancel={handleCancel}
        />
      )}
    </Show>
  );
};
