import { EntityAppearanceMenu } from '@app/features/entity-appearance/appearance-menu';
import { readEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import DuplicateIcon from '@icon/system/regular/copy.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import WebhookIcon from '@phosphor/webhooks-logo.svg';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dropdown } from '@ui/components/Dropdown';
import type { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import {
  type DatabaseEntityFailure,
  databaseEntityMessage,
} from '../../database/core/write-failure';

import {
  createDatabaseTransfers,
  type DatabaseEntityActions,
} from './shared/database-transfers';

export type { DatabaseEntityActions };

export function DatabasePageActions(props: {
  detail: DatabaseDetail;
  table?: TableDetail;
  entityActions?: DatabaseEntityActions;
  onImported: (tableId: string) => void;
  onRename: () => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
}) {
  const transfers = createDatabaseTransfers(props);
  const editable = transfers.editable;
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal('');
  let menuButton: HTMLButtonElement | undefined;
  let focusTitleAfterClose = false;
  async function removeDatabase() {
    if (deleting() || props.detail.grant !== 'owner') return;
    setDeleting(true);
    setDeleteError('');
    const deleted = await props.onDelete();
    setDeleting(false);
    deleted.match(
      () => setConfirmDelete(false),
      (failure) => setDeleteError(databaseEntityMessage(failure, 'delete'))
    );
  }
  return (
    <>
      {transfers.fileInput()}
      <Dropdown>
        <Dropdown.Trigger
          aria-label="Database actions"
          tooltip="Database actions"
          ref={menuButton}
          variant="ghost"
          size="icon-sm"
        >
          <DotsThreeIcon class="size-5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          class="w-56"
          onCloseAutoFocus={(event) => {
            if (focusTitleAfterClose) {
              event.preventDefault();
              focusTitleAfterClose = false;
              queueMicrotask(props.onRename);
            } else if (confirmDelete()) event.preventDefault();
          }}
        >
          <Show when={props.entityActions}>
            {(actions) => (
              <>
                <Dropdown.Group>
                  <Show when={editable() && appearanceFlag().enabled}>
                    <EntityAppearanceMenu
                      entity={{
                        type: 'database',
                        id: props.detail.database.id,
                        name: props.detail.database.name,
                        ownerId: props.detail.database.owner_id,
                        grant: props.detail.grant,
                        appearance: readEntityAppearance(
                          props.detail.database.appearance
                        ),
                        projectId:
                          props.detail.database.project_id ?? undefined,
                      }}
                    />
                  </Show>
                  <Dropdown.CopyItem
                    icon={<LinkIcon class="size-4" />}
                    onCopy={actions().onCopyLink}
                  >
                    Copy Link
                  </Dropdown.CopyItem>
                  <Dropdown.CopyItem onCopy={actions().onCopyId}>
                    Copy ID
                  </Dropdown.CopyItem>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={actions().onToggleFavorite}>
                    <StarIcon class="size-4 shrink-0" />
                    {actions().favorited ? 'Unfavorite' : 'Favorite'}
                  </Dropdown.Item>
                  <Show when={actions().onMoveToFolder}>
                    {(moveToFolder) => (
                      <Dropdown.Item onSelect={moveToFolder()}>
                        <FolderIcon class="size-4 shrink-0" />
                        {t('entityActions.moveToFolder')}
                      </Dropdown.Item>
                    )}
                  </Show>
                </Dropdown.Group>
              </>
            )}
          </Show>
          <Show when={editable() || props.entityActions}>
            <Dropdown.Group>
              <Show when={editable()}>
                <Dropdown.Item onSelect={() => (focusTitleAfterClose = true)}>
                  <PencilIcon class="size-4 shrink-0" />
                  Rename
                </Dropdown.Item>
              </Show>
              <Show when={props.entityActions}>
                {(actions) => (
                  <Dropdown.Item
                    disabled={actions().duplicating}
                    onSelect={actions().onDuplicate}
                  >
                    <DuplicateIcon class="size-4 shrink-0" />
                    {t('entityActions.duplicate')}
                  </Dropdown.Item>
                )}
              </Show>
            </Dropdown.Group>
          </Show>
          <Dropdown.Group>
            <Show when={editable()}>
              <Dropdown.Item
                disabled={transfers.reading()}
                onSelect={transfers.chooseCsv}
              >
                <UploadIcon class="size-4 shrink-0" />
                Import CSV
              </Dropdown.Item>
              <Dropdown.Item
                disabled={!props.table}
                onSelect={transfers.openWebhooks}
              >
                <WebhookIcon class="size-4 shrink-0" />
                Webhooks
              </Dropdown.Item>
            </Show>
            <Dropdown.Sub>
              <Dropdown.SubTrigger disabled={transfers.exporting()}>
                <DownloadIcon class="size-4 shrink-0" />
                <span class="flex-1">Download</span>
                <CaretRightIcon class="size-3.5 shrink-0" />
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-56">
                <Dropdown.Item
                  disabled={!props.table || transfers.exporting()}
                  onSelect={transfers.exportCsv}
                >
                  <DownloadIcon class="size-4 shrink-0" />
                  Current table as CSV
                </Dropdown.Item>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
          <Show when={props.detail.grant === 'owner'}>
            <Dropdown.Group>
              <Dropdown.Item
                class="text-failure-ink"
                onSelect={() => {
                  setDeleteError('');
                  setConfirmDelete(true);
                }}
              >
                <TrashIcon class="size-4 shrink-0" />
                Delete
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
      {transfers.dialogs(() => menuButton)}
      <DeleteDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete database?"
        pending={deleting()}
        onDelete={() =>
          fireAndForget(removeDatabase(), 'database-page-actions')
        }
        body={
          <>
            <p>
              “{props.detail.database.name}” and its tables and views will be
              moved to Trash.
            </p>
            <Show when={deleteError()}>
              <p role="alert" class="mt-2 text-failure-ink">
                {deleteError()}
              </p>
            </Show>
          </>
        }
      />
    </>
  );
}
