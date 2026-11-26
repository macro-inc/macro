import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { toastMovedToFolder } from '@app/features/entity/bulk-edit/moved-to-folder-toast';
import { readEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import {
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeFavoriteAction,
} from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useGetPermissions } from '@core/signal/permissions';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazy } from '@core/util/lazy';
import type { DatabaseEntity } from '@entity';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import type { ResultAsync } from 'neverthrow';
import { createSignal, type JSX, Suspense } from 'solid-js';
import {
  type DatabaseEntityFailure,
  databaseEntityMessage,
} from '../../../database/core/write-failure';
import { renameDatabase } from '../../queries/rename-database';
import type { DatabaseEntityActions } from './database-transfers';

// Forms load only when the flag is on, and only through this boundary.
const DatabaseFormEditors = lazy(async () => ({
  default: (await import('@app/features/block-form/database-forms-entry'))
    .DatabaseFormEditors,
}));

/** What the database page's header shows and does, on desktop and on touch. */
export type DatabaseHeaderProps = {
  databaseId: string;
  detail: DatabaseDetail | undefined;
  canEdit: boolean;
  activeTable: TableDetail | undefined;
  /** Feature-owned items of the tables' add menu, e.g. the table's forms. */
  tableMenuItems: (() => JSX.Element) | undefined;
  onSelectTable: (tableId: string) => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
  openingChat: boolean;
  onOpenChat: () => void;
};

/** The database as an entity, and the entity actions both headers offer. */
export function createDatabaseHeader(props: DatabaseHeaderProps) {
  const databaseId = props.databaseId;
  const permissions = useGetPermissions();
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
      audience: () => (
        <Suspense>
          <DatabaseFormEditors databaseId={databaseId} />
        </Suspense>
      ),
    };
  });
  const favoriteAction = makeFavoriteAction();
  const copyLinkAction = makeCopyLinkAction({ silent: true });
  const copyEntityIdAction = makeCopyEntityIdAction({ silent: true });
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
    appearance: readEntityAppearance(detail.database.appearance),
    projectId: detail.database.project_id ?? undefined,
  });
  const entityActions = (detail: DatabaseDetail): DatabaseEntityActions => ({
    favorited: favoriteAction.isFavorited(entity(detail)),
    onToggleFavorite: () =>
      fireAndForget(
        favoriteAction.execute([entity(detail)]),
        'database-actions'
      ),
    onCopyLink: () => copyLinkAction.execute([entity(detail)]),
    onCopyId: () => copyEntityIdAction.executeById(databaseId),
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

  return { name, permissions, openShare, entity, entityActions, rename };
}
