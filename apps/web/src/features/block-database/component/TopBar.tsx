import { EntityAppearanceTrigger } from '@app/features/entity-appearance/entity-appearance';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';
import { DatabaseTitle } from '../../database/components/database-title';
import { DatabasePageActions } from '../views/database-page-actions';
import {
  createDatabaseHeader,
  type DatabaseHeaderProps,
} from '../views/shared/database-header';
import { TableTabs } from './TableTabs';

/** The database page's desktop header. */
export function TopBar(props: DatabaseHeaderProps) {
  const databaseId = props.databaseId;
  const { name, openShare, entity, entityActions, rename } =
    createDatabaseHeader(props);
  let editTitle: (() => void) | undefined;

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          name={name}
          icon={
            <Show when={props.detail}>
              {(detail) => (
                <EntityAppearanceTrigger
                  entity={entity(detail())}
                  editable={props.canEdit}
                />
              )}
            </Show>
          }
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
                  menuItems={props.tableMenuItems}
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
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <Show when={props.detail}>
        <SplitHeaderRight>
          <HeaderActionGroup label="Database actions">
            <ButtonGroup.Button
              variant="ghost"
              size="sm"
              class="gap-1.5"
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
