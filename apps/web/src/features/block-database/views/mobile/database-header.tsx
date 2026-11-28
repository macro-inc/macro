import { ChatWithAgentIcon } from '@app/features/chat/ChatWithAgentButton';
import { openBulkEditModal } from '@app/features/entity/bulk-edit/BulkEditEntityModal';
import { RENAME_FIELD_SELECTOR } from '@app/features/entity/utils/rename-field-focus';
import { EntityAppearanceTrigger } from '@app/features/entity-appearance/entity-appearance';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import {
  type FileOperation,
  SplitFileMenu,
} from '@components/app/split-layout/components/SplitFileMenu';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import DuplicateIcon from '@icon/system/regular/copy.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import RenameIcon from '@icon/system/regular/pencil-line.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import WebhookIcon from '@phosphor/webhooks-logo.svg';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { Show } from 'solid-js';
import { TableTabs } from '../../component/TableTabs';
import {
  createDatabaseHeader,
  type DatabaseHeaderProps,
} from '../shared/database-header';
import { databaseTitleMenuRows } from '../shared/database-title-menu';
import { createDatabaseTransfers } from '../shared/database-transfers';

/**
 * The database page's header on touch: the title with its menu, the access
 * badge, who else is here, Share and Info. Everything else the desktop header
 * offers is a row of the title menu, so the title keeps the header's width.
 * Tablets have room for the table tabs; a phone switches tables in its
 * toolbar.
 */
export function MobileDatabaseHeader(props: DatabaseHeaderProps) {
  const header = createDatabaseHeader(props);

  return (
    <>
      <MobileHeader
        trailing={
          <>
            <BlockLiveIndicators />
            <MobileHeader.Island>
              <ShareTrigger onClick={header.openShare} showCopyLink={false} />
            </MobileHeader.Island>
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          class="ph-no-capture"
          iconType="database"
          colorIcon
          icon={
            <Show when={props.detail}>
              {(detail) => (
                <EntityAppearanceTrigger
                  entity={header.entity(detail())}
                  editable={props.canEdit}
                />
              )}
            </Show>
          }
          label={header.name()}
        />
        <Show when={!isMobile() && props.detail}>
          {(detail) => (
            <MobileHeader.Island class="max-w-xl shrink">
              <TableTabs
                databaseId={props.databaseId}
                tables={detail().tables}
                activeTableId={props.activeTable?.table.id}
                canEdit={props.canEdit}
                onSelect={props.onSelectTable}
                menuItems={props.tableMenuItems}
              />
            </MobileHeader.Island>
          )}
        </Show>
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>
      <Show when={props.detail}>
        {(detail) => (
          <DatabaseTitleMenu {...props} detail={detail()} header={header} />
        )}
      </Show>
    </>
  );
}

/**
 * The title menu: the entity's own actions, then what the desktop header
 * shows as buttons or in Database actions.
 */
function DatabaseTitleMenu(
  props: Omit<DatabaseHeaderProps, 'detail'> & {
    detail: DatabaseDetail;
    header: ReturnType<typeof createDatabaseHeader>;
  }
) {
  const transfers = createDatabaseTransfers({
    get detail() {
      return props.detail;
    },
    get table() {
      return props.activeTable;
    },
    onTableAdded: (tableId) => props.onSelectTable(tableId),
  });
  const entity = () => props.header.entity(props.detail);
  const rows = () =>
    databaseTitleMenuRows({
      canEdit: transfers.editable(),
      hasTable: !!props.activeTable,
    });

  const tools = (): BlockTool[] => [
    {
      label: t('entityActions.askMacro'),
      icon: ChatWithAgentIcon,
      group: 'macro',
      disabledReason: props.openingChat ? 'Opening the chat…' : undefined,
      action: props.onOpenChat,
    },
  ];
  const ops = (): FileOperation[] =>
    rows().map((row): FileOperation => {
      if (row === 'duplicate') {
        const actions = props.header.entityActions(props.detail);

        // The header's own copy, which makes one at a time.
        return {
          id: row,
          label: t('entityActions.duplicate'),
          icon: DuplicateIcon,
          group: 'file',
          action: () => {
            if (!actions.duplicating) actions.onDuplicate();
          },
        };
      }
      if (row === 'move-to-folder') return { op: 'moveToProject' };
      if (row === 'delete') return { op: 'delete' };

      if (row === 'rename')
        return {
          id: row,
          label: t('entityActions.rename'),
          icon: RenameIcon,
          group: 'file',
          action: () => {
            // iOS raises the keyboard only for a focus inside the tap.
            triggerFocusNewElement(RENAME_FIELD_SELECTOR, { touchOnly: true });
            openBulkEditModal({
              view: 'rename',
              entities: [entity()],
              onFinish: () => toast.success(t('entityActions.toastRenamed')),
              onError: () =>
                toast.failure(t('entityActions.toastRenameFailed')),
            });
          },
        };

      if (row === 'import-csv')
        return {
          id: row,
          label: 'Import CSV',
          icon: UploadIcon,
          group: 'file',
          action: transfers.chooseCsv,
        };

      if (row === 'webhooks')
        return {
          id: row,
          label: 'Webhooks',
          icon: WebhookIcon,
          group: 'file',
          action: transfers.openWebhooks,
        };

      if (row === 'sync')
        return {
          id: row,
          label: t('databaseSyncs.syncFrom'),
          icon: ArrowsClockwiseIcon,
          group: 'file',
          action: transfers.openSync,
        };

      return {
        id: row,
        label: 'Download table as CSV',
        icon: DownloadIcon,
        group: 'file',
        action: transfers.exportCsv,
      };
    });

  return (
    <>
      {transfers.fileInput()}
      <SplitFileMenu
        id={props.databaseId}
        itemType="database"
        entityKind="database"
        name={props.detail.database.name}
        mobileTitle={props.detail.database.name}
        entity={entity()}
        permissions={props.header.permissions()}
        tools={tools()}
        ops={ops()}
      />
      {transfers.dialogs(() => undefined)}
    </>
  );
}
