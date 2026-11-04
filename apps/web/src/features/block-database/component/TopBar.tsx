import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { toastMovedToFolder } from '@app/features/entity/bulk-edit/moved-to-folder-toast';
import {
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeFavoriteAction,
} from '@app/features/next-soup/actions';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { ResponsivePermissionsBadge } from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { enableForms } from '@core/constant/featureFlags';
import { useGetPermissions } from '@core/signal/permissions';
import { fireAndForget } from '@core/util/fireAndForget';
import type { DatabaseEntity } from '@entity';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { ButtonGroup } from '@ui';
import type { ResultAsync } from 'neverthrow';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import { DatabaseTitle } from '../../database/components/database-title';
import {
  type DatabaseEntityFailure,
  databaseEntityMessage,
} from '../../database/core/write-failure';
import { renameDatabase } from '../queries/rename-database';
import {
  type DatabaseEntityActions,
  DatabasePageActions,
} from '../views/database-page-actions';
import { TableTabs } from './TableTabs';

// Forms load only when the flag is on, and only through this boundary.
const DatabaseFormsEntry = lazy(async () => ({
  default: (await import('@app/features/block-form/database-forms-entry'))
    .DatabaseFormsEntry,
}));
const DatabaseFormEditors = lazy(async () => ({
  default: (await import('@app/features/block-form/database-forms-entry'))
    .DatabaseFormEditors,
}));

export function TopBar(props: {
  databaseId: string;
  detail: DatabaseDetail | undefined;
  canEdit: boolean;
  activeTable: TableDetail | undefined;
  onSelectTable: (tableId: string) => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
  openingChat: boolean;
  onOpenChat: () => void;
}) {
  const databaseId = props.databaseId;
  const permissions = useGetPermissions();
  const formsFlag = useFeatureFlag(enableForms);
  let editTitle: (() => void) | undefined;
  const name = () => props.detail?.database.name ?? 'Database';
  const openShare = useShareModal(() => {
    const detail = props.detail;
    if (!detail) return;
    return {
      id: databaseId,
      blockAlias: 'database',
      itemType: 'database',
      name: detail.database.name,
      owner: detail.database.owner_id,
      userPermissions: permissions(),
      // Form editors hold Edit here through their form: say so, and where.
      audience: formsFlag().enabled
        ? () => (
            <Suspense>
              <DatabaseFormEditors databaseId={databaseId} />
            </Suspense>
          )
        : undefined,
    };
  });
  const favoriteAction = makeFavoriteAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyEntityIdAction = makeCopyEntityIdAction();
  const itemOperations = useItemOperations();
  const { replaceOrInsertSplit } = useSplitLayout();
  // One copy at a time: the menu can reopen while a copy is being written.
  const [duplicating, setDuplicating] = createSignal(false);
  const duplicate = async (detail: DatabaseDetail) => {
    if (duplicating()) return;
    setDuplicating(true);
    const copy = await itemOperations
      .copyItem({
        itemType: 'database',
        id: databaseId,
        name: detail.database.name,
      })
      .finally(() => setDuplicating(false));
    if (copy)
      replaceOrInsertSplit(
        { id: copy, type: 'database' },
        'entity-actions-menu'
      );
  };
  const entity = (detail: DatabaseDetail): DatabaseEntity => ({
    type: 'database',
    id: databaseId,
    name: detail.database.name,
    ownerId: detail.database.owner_id,
    grant: detail.grant,
    projectId: detail.database.project_id ?? undefined,
  });
  const entityActions = (detail: DatabaseDetail): DatabaseEntityActions => ({
    favorited: favoriteAction.isFavorited(entity(detail)),
    onToggleFavorite: () =>
      fireAndForget(
        favoriteAction.execute([entity(detail)]),
        'database-actions'
      ),
    onCopyLink: () =>
      fireAndForget(
        copyLinkAction.execute([entity(detail)]),
        'database-actions'
      ),
    onCopyId: () =>
      fireAndForget(
        copyEntityIdAction.executeById(databaseId),
        'database-actions'
      ),
    duplicating: duplicating(),
    onDuplicate: () => fireAndForget(duplicate(detail), 'database-actions'),
    onMoveToFolder:
      detail.grant === 'owner'
        ? () =>
            openBulkEditModal({
              view: 'moveToProject',
              entities: [entity(detail)],
              onMoved: (folder) => toastMovedToFolder(1, folder.id),
              onError: () =>
                toast.failure(t('entityActions.toastMoveToFolderFailed')),
            })
        : undefined,
  });
  const rename = (next: string) => {
    renameDatabase(getEntityGraphqlClient(), databaseId, next).mapErr(
      (failure) => toast.failure(databaseEntityMessage(failure, 'rename'))
    );
  };

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          name={name}
          title={
            <Show when={props.detail}>
              <DatabaseTitle
                name={name()}
                canEdit={props.canEdit}
                onEditReady={(edit) => (editTitle = edit)}
                onRename={rename}
              />
            </Show>
          }
        />
        <Show when={props.detail}>
          {(detail) => (
            <>
              <DatabasePageActions
                detail={detail()}
                table={props.activeTable}
                entityActions={entityActions(detail())}
                onRename={() => editTitle?.()}
                onDelete={props.onDelete}
                onImported={props.onSelectTable}
              />
              <div class="ml-2 min-w-0 max-w-xl shrink">
                <TableTabs
                  databaseId={databaseId}
                  tables={detail().tables}
                  activeTableId={props.activeTable?.table.id}
                  canEdit={props.canEdit}
                  onSelect={props.onSelectTable}
                  menuItems={
                    formsFlag().enabled && props.activeTable
                      ? () => (
                          <Suspense>
                            <DatabaseFormsEntry
                              databaseId={databaseId}
                              tableId={props.activeTable?.table.id}
                              tableName={props.activeTable?.table.name}
                              canCreate={props.detail?.grant === 'owner'}
                              enabled
                            />
                          </Suspense>
                        )
                      : undefined
                  }
                />
              </div>
            </>
          )}
        </Show>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
        <div class="order-[1000] flex items-center gap-2">
          <ShareTrigger onClick={openShare} />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <Show when={props.detail}>
        <SplitHeaderRight>
          <HeaderActionGroup label="Database actions">
            <ButtonGroup.Button
              variant="ghost"
              size="sm"
              class="gap-1.5 touch:px-2 touch:text-xs"
              disabled={props.openingChat}
              aria-label="Database AI"
              aria-busy={props.openingChat}
              onClick={props.onOpenChat}
            >
              <SparkleIcon class="size-4" />
              <span>AI</span>
            </ButtonGroup.Button>
          </HeaderActionGroup>
        </SplitHeaderRight>
      </Show>
    </>
  );
}
