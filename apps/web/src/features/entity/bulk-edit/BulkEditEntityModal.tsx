import {
  BulkShare,
  type BulkShareHandle,
} from '@app/features/sharing/share-delivery/bulk-share';
import { ShareDialog } from '@core/component/TopBar/ShareDialog';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import type { EntityData } from '@entity';
import { ActionDialogShell, Dialog } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { BulkDeleteView, type PartialDeleteHandler } from './BulkDeleteView';
import {
  BulkMoveToProjectView,
  type MovedFolder,
} from './BulkMoveToProjectView';
import { BulkRenameEntitiesView } from './BulkRenameEntitiesView';

export type BulkEditView = 'rename' | 'moveToProject' | 'delete' | 'share';

const BulkEditEntityModalContent = (props: {
  isOpen: Accessor<boolean>;
  view: BulkEditView;
  entities: EntityData[];
  onFinish: () => void;
  onMoved?: (folder: MovedFolder) => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
  /** What else the deletion removes, under its description. */
  note?: string;
}) => {
  const handleMoved = (folder: MovedFolder) => {
    const { onMoved } = props;
    props.onFinish();
    onMoved?.(folder);
  };
  let share: BulkShareHandle | undefined;
  const onOpenChange = (open: boolean) => {
    if (!open) (share?.dismiss ?? props.onCancel)();
  };

  return (
    <Show
      when={props.view === 'share'}
      fallback={
        <Dialog
          open={props.isOpen()}
          position={props.view === 'moveToProject' ? 'top' : 'center'}
          class={props.view === 'moveToProject' ? 'w-140' : 'w-110'}
          onOpenChange={onOpenChange}
        >
          <Show
            when={props.view === 'moveToProject'}
            fallback={
              <ActionDialogShell>
                <Show when={props.view === 'rename'}>
                  <BulkRenameEntitiesView
                    entities={props.entities}
                    onFinish={props.onFinish}
                    onCancel={props.onCancel}
                    onError={props.onError}
                  />
                </Show>
                <Show when={props.view === 'delete'}>
                  <BulkDeleteView
                    note={props.note}
                    onPartialDelete={props.onPartialDelete}
                    entities={props.entities}
                    onFinish={props.onFinish}
                    onCancel={props.onCancel}
                    onError={props.onError}
                  />
                </Show>
              </ActionDialogShell>
            }
          >
            <BulkMoveToProjectView
              entities={props.entities}
              onMoved={handleMoved}
              onCancel={props.onCancel}
              onError={props.onError}
            />
          </Show>
        </Dialog>
      }
    >
      <ShareDialog open={props.isOpen()} onOpenChange={onOpenChange}>
        <BulkShare
          entities={props.entities}
          onFinish={props.onFinish}
          onCancel={props.onCancel}
          ref={(handle) => {
            share = handle;
          }}
        />
      </ShareDialog>
    </Show>
  );
};

type BulkEditSession = {
  view: BulkEditView;
  entities: EntityData[];
  onFinish?: () => void;
  onMoved?: (folder: MovedFolder) => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  onPartialDelete?: PartialDeleteHandler;
  /** What else the deletion removes, under its description. */
  note?: string;
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
          onMoved={session.onMoved}
          onCancel={() => close(session.onCancel)}
          onError={session.onError}
          onPartialDelete={session.onPartialDelete}
          note={session.note}
        />
      );
    }}
  </Show>
);
