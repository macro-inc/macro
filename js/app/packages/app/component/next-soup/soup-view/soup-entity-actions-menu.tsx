import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { MenuItem } from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import {
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
  makeShareAction,
} from '../actions';
import type { SoupState } from '../create-soup-state';
import { useUserId } from '@core/context/user';
import { useAnalytics } from '@app/component/analytics-context';

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  soup: SoupState;
  onActionComplete?: () => void;
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const analytics = useAnalytics();

  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
  });

  const deleteAction = makeDeleteAction({
    userId: () => userId(),
  });

  const renameAction = makeRenameAction({
    userId: () => userId(),
  });

  const copyAction = makeCopyAction();

  const moveToProjectAction = makeMoveToProjectAction();

  const copyLinkAction = makeCopyLinkAction();

  const copyBranchNameAction = makeCopyBranchNameAction();

  const shareAction = makeShareAction();

  const canExecuteAny = (canExecute: (e: EntityData) => boolean) =>
    props.entities.some(canExecute);

  const canExecuteAll = (canExecute: (e: EntityData) => boolean) =>
    props.entities.length > 0 && props.entities.every(canExecute);

  const handleAction = async (
    execute: (entities: EntityData[], soup: SoupState) => Promise<void>
  ) => {
    await execute(props.entities, props.soup);
    props.onActionComplete?.();
  };

  const canOpenInSplit = () => {
    if (props.entities.length !== 1) return false;
    const entity = props.entities[0];
    const splits = globalSplitManager()?.splits;
    if (!splits) return false;
    return !splits().some((split) => split.content.id === entity.id);
  };

  const openInNewSplit = () => {
    const entity = props.entities[0];
    if (!entity) return;

    const splitManager = globalSplitManager();
    if (!splitManager) return;

    analytics.track('split_created', { from: 'soup_view_entity_actions_menu' });

    if (entity.type === 'document') {
      const { fileType, id, subType } = entity;
      splitManager.createNewSplit({
        content: {
          type: fileTypeToBlockName(subType?.type ?? fileType),
          id,
        },
        referredFrom: 'entity-actions-menu',
      });
    } else {
      splitManager.createNewSplit({
        content: {
          type: entity.type,
          id: entity.id,
        },
        referredFrom: 'entity-actions-menu',
      });
    }
  };

  return (
    <>
      <MenuItem
        text="Mark Done"
        disabled={!canExecuteAny(markDone.canExecute)}
        onClick={() => handleAction(markDone.executeWithSoup)}
      />

      <MenuItem
        text="Open in new split"
        disabled={!canOpenInSplit()}
        onClick={openInNewSplit}
      />

      <Divider />

      <MenuItem
        text="Rename"
        disabled={!canExecuteAll(renameAction.canExecute)}
        onClick={() => handleAction(renameAction.executeWithSoup)}
      />

      <MenuItem
        text="Move to folder"
        disabled={!canExecuteAny(moveToProjectAction.canExecute)}
        onClick={() => handleAction(moveToProjectAction.executeWithSoup)}
      />

      <MenuItem
        text="Duplicate"
        disabled={!canExecuteAny(copyAction.canExecute)}
        onClick={() => handleAction(copyAction.executeWithSoup)}
      />

      <MenuItem
        text="Copy Link"
        disabled={props.entities.length !== 1}
        onClick={() => handleAction(copyLinkAction.executeWithSoup)}
      />

      <MenuItem
        text="Copy Branch Name"
        disabled={
          props.entities.length !== 1 ||
          !copyBranchNameAction.canExecute(props.entities[0])
        }
        onClick={() => handleAction(copyBranchNameAction.executeWithSoup)}
      />

      <MenuItem
        text="Share"
        disabled={
          props.entities.length !== 1 ||
          !shareAction.canExecute(props.entities[0])
        }
        onClick={() => handleAction(shareAction.executeWithSoup)}
      />

      <Divider />

      <div class="text-failure-ink w-full">
        <MenuItem
          text="Delete"
          disabled={!canExecuteAll(deleteAction.canExecute)}
          onClick={() => handleAction(deleteAction.executeWithSoup)}
        />
      </div>
    </>
  );
};

const Divider = () => <div class="border-b border-edge-muted w-full my-1" />;
