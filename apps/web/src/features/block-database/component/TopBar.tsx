import { ResponsivePermissionsBadge } from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@components/app/split-layout/components/SplitToolbar';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useGetPermissions } from '@core/signal/permissions';
import SparkleIcon from '@phosphor/sparkle.svg';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import type { ResultAsync } from 'neverthrow';
import { Show } from 'solid-js';
import { DatabaseTitle } from '../components/database-title';
import {
  type DatabaseEntityFailure,
  databaseEntityMessage,
} from '../core/write-failure';
import { renameDatabase } from '../queries/rename-database';
import { DatabasePageActions } from '../views/database-page-actions';
import { TableTabs } from './TableTabs';

export function TopBar(props: {
  databaseId: string;
  detail: DatabaseDetail | undefined;
  canEdit: boolean;
  activeTable: TableDetail | undefined;
  /** Opens the title for typing, as for a freshly created database. */
  autoFocusTitle: boolean;
  onTitleConfirm: () => void;
  onSelectTable: (tableId: string) => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
  openingChat: boolean;
  onOpenChat: () => void;
}) {
  const databaseId = props.databaseId;
  const permissions = useGetPermissions();
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
    };
  });
  const rename = (next: string) =>
    void renameDatabase(getEntityGraphqlClient(), databaseId, next).mapErr(
      (failure) => toast.failure(databaseEntityMessage(failure, 'rename'))
    );

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
                autoFocus={props.autoFocusTitle}
                onConfirm={props.onTitleConfirm}
                onEditReady={(edit) => (editTitle = edit)}
                onRename={rename}
              />
            </Show>
          }
        />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
        <div class="order-[1000] flex items-center gap-1">
          <ShareTrigger onClick={openShare} />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <Show when={props.detail}>
        {(detail) => (
          <>
            <SplitToolbarLeft class="min-w-0">
              <TableTabs
                databaseId={databaseId}
                tables={detail().tables}
                activeTableId={props.activeTable?.table.id}
                canEdit={props.canEdit}
                onSelect={props.onSelectTable}
              />
            </SplitToolbarLeft>
            <SplitToolbarRight>
              <DatabasePageActions
                detail={detail()}
                table={props.activeTable}
                onRename={() => editTitle?.()}
                onDelete={props.onDelete}
                onImported={props.onSelectTable}
              />
              <Button
                variant="ghost"
                size="sm"
                class="gap-1.5 px-2 text-xs"
                disabled={props.openingChat}
                aria-label="Database AI"
                aria-busy={props.openingChat}
                onClick={props.onOpenChat}
              >
                <SparkleIcon class="size-4" />
                <span>AI</span>
              </Button>
            </SplitToolbarRight>
          </>
        )}
      </Show>
    </>
  );
}
