import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Dialog } from '@kobalte/core/dialog';
import type { EntityData } from '@macro-entity';
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

export const BulkEditEntityModalTitle = (props: { title: string }) => {
  return <h2 class="text-xl mb-4">{props.title}</h2>;
};

export const BulkEditEntityModalActionFooter = (props: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText: string;
  isDisabled?: boolean;
}) => {
  return (
    <div class="flex w-full justify-end items-stretch tex-sm gap-1">
      <div class="wi-dill w-20 h-full bg-yellow-400"> </div>
      <button
        class="py-1 px-3 text-sm border-edge-muted border bg-panel"
        onClick={props.onCancel}
      >
        Cancel
      </button>
      <button
        // class={`uppercase py-1 px-3 font-mono text-sm ${
        //   props.isDisabled
        //     ? 'bg-edge/20 text-ink-placeholder cursor-not-allowed'
        //     : 'bg-accent text-menu'
        // }`}
        class="uppercase py1 px-3 text-sm font-semibold bg-accent/10 text-accent border border-accent/20"
        onClick={props.onConfirm}
        disabled={props.isDisabled}
      >
        {props.confirmText}
      </button>
    </div>
  );
};

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
    <Dialog open={props.isOpen()} onOpenChange={props.setIsOpen} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay" />
        <div class="fixed inset-0 z-modal">
          <Dialog.Content>
            <div class="pointer-events-auto max-w-xl bg-menu border border-edge-muted w-lg h-fit p-2 mt-[25vh] mx-auto">
              <div class="w-full my-1">
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
            </div>
          </Dialog.Content>
        </div>
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
const [modalOpen, setModalOpen] = createControlledOpenSignal();

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
