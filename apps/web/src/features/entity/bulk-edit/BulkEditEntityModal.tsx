import {
  BulkShare,
  type BulkShareHandle,
} from '@app/features/sharing/share-delivery/bulk-share';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { ActionDialogShell, Dialog } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { BulkDeleteView, type PartialDeleteHandler } from './BulkDeleteView';
import { BulkMoveToProjectView } from './BulkMoveToProjectView';
import { BulkRenameEntitiesView } from './BulkRenameEntitiesView';

export type BulkEditView = 'rename' | 'moveToProject' | 'delete' | 'share';

const BulkEditEntityModalContent = (props: {
  isOpen: Accessor<boolean>;
  view: BulkEditView;
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
}) => {
  let share: BulkShareHandle | undefined;

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
        if (!open) (share?.dismiss ?? props.onCancel)();
      }}
    >
      <ActionDialogShell>
        <Show when={props.view === 'rename'}>
          <BulkRenameEntitiesView
            entities={props.entities}
            onFinish={props.onFinish}
            onCancel={props.onCancel}
            onError={props.onError}
          />
        </Show>
        <Show when={props.view === 'moveToProject'}>
          <BulkMoveToProjectView
            entities={props.entities}
            onFinish={props.onFinish}
            onCancel={props.onCancel}
            onError={props.onError}
          />
        </Show>
        <Show when={props.view === 'delete'}>
          <BulkDeleteView
            onPartialDelete={props.onPartialDelete}
            entities={props.entities}
            onFinish={props.onFinish}
            onCancel={props.onCancel}
            onError={props.onError}
          />
        </Show>
        <Show when={props.view === 'share'}>
          <BulkShare
            entities={props.entities}
            onFinish={props.onFinish}
            onCancel={props.onCancel}
            ref={(handle) => {
              share = handle;
            }}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
};

type BulkEditSession = {
  view: BulkEditView;
  entities: EntityData[];
  onFinish?: () => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
};

const [globalSession, setGlobalSession] = createSignal<BulkEditSession>();
const [modalOpen, setModalOpen] = createControlledOpenSignal(false, {
  id: 'entity-edit',
});

export const openBulkEditModal = (session: BulkEditSession) => {
  setModalOpen(true);
  setGlobalSession(session);
};

export const GlobalBulkEditEntityModal = () => (
  <Show when={globalSession()} keyed>
    {(session) => {
      const close = (then?: () => void) => {
        if (globalSession() !== session) return;
        setModalOpen(false);
        setGlobalSession(undefined);
        then?.();
      };
      return (
        <BulkEditEntityModalContent
          isOpen={modalOpen}
          view={session.view}
          entities={session.entities}
          onFinish={() => close(session.onFinish)}
          onCancel={() => close(session.onCancel)}
          onError={session.onError}
          onPartialDelete={session.onPartialDelete}
        />
      );
    }}
  </Show>
);
