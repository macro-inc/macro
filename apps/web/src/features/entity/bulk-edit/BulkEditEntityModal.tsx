import { BulkShare } from '@app/features/sharing/share-delivery/bulk-share';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { ActionDialogShell, Dialog } from '@ui';
import {
  type Accessor,
  createSignal,
  type ParentComponent,
  type Setter,
  Show,
} from 'solid-js';
import { BulkDeleteView, type PartialDeleteHandler } from './BulkDeleteView';
import { BulkMoveToProjectView } from './BulkMoveToProjectView';
import { BulkRenameEntitiesView } from './BulkRenameEntitiesView';

export type BulkEditView = 'rename' | 'moveToProject' | 'delete' | 'share';

const BulkEditEntityModalContent = (props: {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: BulkEditView | null;
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
}) => {
  const [dismissFinishes, setDismissFinishes] = createSignal(false);
  const handleFinish = () => {
    props.setIsOpen(false);
    props.onFinish?.();
  };
  const handleCancel = () => {
    props.setIsOpen(false);
    props.onCancel?.();
  };
  const handleError = (error: unknown) => {
    props.onError?.(error);
  };

  return (
    <Dialog
      open={props.isOpen()}
      position="center"
      class={
        props.view === 'moveToProject' || props.view === 'share'
          ? 'w-120'
          : 'w-110'
      }
      onOpenChange={(open) => {
        if (!open) {
          if (dismissFinishes()) handleFinish();
          else handleCancel();
        }
        props.setIsOpen(open);
      }}
    >
      <ActionDialogShell>
        <Show when={props.view === 'rename'}>
          <BulkRenameEntitiesView
            entities={props.entities}
            onFinish={handleFinish}
            onCancel={handleCancel}
            onError={handleError}
          />
        </Show>
        <Show when={props.view === 'moveToProject'}>
          <BulkMoveToProjectView
            entities={props.entities}
            onFinish={handleFinish}
            onCancel={handleCancel}
            onError={handleError}
          />
        </Show>
        <Show when={props.view === 'delete'}>
          <BulkDeleteView
            onPartialDelete={props.onPartialDelete}
            entities={props.entities}
            onFinish={handleFinish}
            onCancel={handleCancel}
            onError={handleError}
          />
        </Show>
        <Show when={props.view === 'share'}>
          <BulkShare
            entities={props.entities}
            onFinish={handleFinish}
            onCancel={handleCancel}
            onDelivered={() => setDismissFinishes(true)}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
};

type BulkEditEntityModalProps = {
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  view: BulkEditView;
  entities: Accessor<EntityData[]>;
};

const _BulkEditEntityModal: ParentComponent<BulkEditEntityModalProps> = (
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
  view: BulkEditView;
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
} | null>(null);
const [modalOpen, setModalOpen] = createControlledOpenSignal(false, {
  id: 'entity-edit',
});

export const openBulkEditModal = (props: {
  view: BulkEditView;
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
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

  const handleError = (error: unknown) => {
    globalModalProps()?.onError?.(error);
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
          onError={handleError}
          onPartialDelete={props().onPartialDelete}
        />
      )}
    </Show>
  );
};
