import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { MenuItem } from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { EntityData } from '@entity';
import {
  makeBlockSenderAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMarkSenderNoiseAction,
  makeMarkSenderSignalAction,
  makeMoveToProjectAction,
  makeRenameAction,
  makeShareAction,
} from '../actions';
import type { SoupState } from '../create-soup-state';
import { useUserId } from '@core/context/user';
import { useAnalytics } from '@app/component/analytics-context';
import { Show } from 'solid-js';
import { useSoupView } from './soup-view-context';

const SIGNAL_TABS = new Set<string | undefined>([
  undefined,
  'signal',
  'important',
]);
const NOISE_TABS = new Set(['noise']);

interface SoupEntityActionsMenuProps {
  entities: EntityData[];
  soup: SoupState;
  onActionComplete?: () => void;
}

export const SoupEntityActionsMenu = (props: SoupEntityActionsMenuProps) => {
  const analytics = useAnalytics();
  const { activeTab } = useSoupView();

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

  const blockSenderAction = makeBlockSenderAction();

  const markSenderSignalAction = makeMarkSenderSignalAction();
  const markSenderNoiseAction = makeMarkSenderNoiseAction();

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

  const showTopGroup = () =>
    canExecuteAny(markDone.canExecute) || canOpenInSplit();

  const showMiddleGroup = () =>
    canExecuteAll(renameAction.canExecute) ||
    canExecuteAny(moveToProjectAction.canExecute) ||
    canExecuteAny(copyAction.canExecute) ||
    props.entities.length === 1;

  const showSenderGroup = () => canExecuteAll(blockSenderAction.canExecute);

  const showDeleteGroup = () => canExecuteAll(deleteAction.canExecute);

  return (
    <>
      <Show when={canExecuteAny(markDone.canExecute)}>
        <MenuItem
          text="Mark Done"
          onClick={() => handleAction(markDone.executeWithSoup)}
        />
      </Show>

      <Show when={canOpenInSplit()}>
        <MenuItem text="Open in new split" onClick={openInNewSplit} />
      </Show>

      <Show when={showTopGroup() && (showMiddleGroup() || showDeleteGroup())}>
        <Divider />
      </Show>

      <Show when={canExecuteAll(renameAction.canExecute)}>
        <MenuItem
          text="Rename"
          onClick={() => handleAction(renameAction.executeWithSoup)}
        />
      </Show>

      <Show when={canExecuteAny(moveToProjectAction.canExecute)}>
        <MenuItem
          text="Move to folder"
          onClick={() => handleAction(moveToProjectAction.executeWithSoup)}
        />
      </Show>

      <Show when={canExecuteAny(copyAction.canExecute)}>
        <MenuItem
          text="Duplicate"
          onClick={() => handleAction(copyAction.executeWithSoup)}
        />
      </Show>

      <Show when={props.entities.length === 1}>
        <MenuItem
          text="Copy Link"
          onClick={() => handleAction(copyLinkAction.executeWithSoup)}
        />
      </Show>

      <Show
        when={
          props.entities.length === 1 &&
          copyBranchNameAction.canExecute(props.entities[0])
        }
      >
        <MenuItem
          text="Copy Branch Name"
          onClick={() => handleAction(copyBranchNameAction.executeWithSoup)}
        />
      </Show>

      <Show
        when={
          props.entities.length === 1 &&
          shareAction.canExecute(props.entities[0])
        }
      >
        <MenuItem
          text="Share"
          onClick={() => handleAction(shareAction.executeWithSoup)}
        />
      </Show>

      <Show when={showSenderGroup() && (showTopGroup() || showMiddleGroup())}>
        <Divider />
      </Show>

      <Show
        when={
          NOISE_TABS.has(activeTab() ?? '') &&
          canExecuteAll(markSenderSignalAction.canExecute)
        }
      >
        <MenuItem
          text="Sender → Signal"
          onClick={() => handleAction(markSenderSignalAction.executeWithSoup)}
        />
      </Show>

      <Show
        when={
          SIGNAL_TABS.has(activeTab()) &&
          canExecuteAll(markSenderNoiseAction.canExecute)
        }
      >
        <MenuItem
          text="Sender → Noise"
          onClick={() => handleAction(markSenderNoiseAction.executeWithSoup)}
        />
      </Show>

      <Show when={showSenderGroup()}>
        <MenuItem
          text="Block Sender"
          onClick={() => handleAction(blockSenderAction.executeWithSoup)}
        />
      </Show>

      <Show
        when={showDeleteGroup() && (showSenderGroup() || showMiddleGroup())}
      >
        <Divider />
      </Show>

      <Show when={showDeleteGroup()}>
        <div class="text-failure-ink w-full">
          <MenuItem
            text="Delete"
            onClick={() => handleAction(deleteAction.executeWithSoup)}
          />
        </div>
      </Show>
    </>
  );
};

const Divider = () => <div class="border-b border-edge-muted w-full my-1" />;
