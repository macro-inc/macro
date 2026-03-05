import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { HotkeyTags } from '@core/hotkey/constants';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import type { SoupState } from '../create-soup-state';
import {
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
  makeShareAction,
} from './index';
import { isShareableEntityType } from '@app/component/global-share-modal/GlobalShareModal';
import { useUserId } from '@core/context/user';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { onCleanup } from 'solid-js';

type UseEntityActionHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  splitHandle?: SplitHandle;
  condition?: () => boolean;
};

export const useEntityActionHotkeys = (
  options: UseEntityActionHotkeysOptions
) => {
  const { scopeId, soup, splitHandle, condition } = options;

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

  const getEntitiesForAction = (): EntityData[] => {
    if (
      splitHandle?.content().type === 'component' &&
      splitHandle?.content().id === 'unified-list'
    ) {
      const selected = soup.selection.selected();
      if (selected.length > 0) return selected;
    }

    const focused = soup.focus.item();
    return focused ? [focused] : [];
  };

  const openNextEntity = (entity: EntityData) => {
    if (!splitHandle) return;
    const handleContent = splitHandle.content().type;
    if (handleContent === 'component' || handleContent === 'project') return;
    openEntityInSplitFromUnifiedList(entity, { splitHandle });
  };

  const group = createHotkeyGroup();

  // Mark Done - 'e', not included in Hotkey Group so that we can use it from inside of blocks
  registerHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId,
    description: 'Mark done',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.some(markDone.canExecute)) return false;

      markDone.executeWithSoup(entities, soup, openNextEntity);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.some(markDone.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  });

  // Delete - 'delete', 'backspace'
  registerHotkey({
    hotkey: ['delete', 'backspace'],
    hotkeyToken: TOKENS.entity.action.delete,
    scopeId,
    description: () => {
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Delete items' : 'Delete item';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(deleteAction.canExecute)) return false;

      deleteAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(deleteAction.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Rename - 'r'
  registerHotkey({
    hotkey: ['r'],
    hotkeyToken: TOKENS.entity.action.rename,
    scopeId,
    description: () => {
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Rename items' : 'Rename item';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(renameAction.canExecute)) return false;

      renameAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(renameAction.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Copy - 'cmd+d'
  registerHotkey({
    hotkey: ['cmd+d'],
    hotkeyToken: TOKENS.entity.action.copy,
    scopeId,
    description: () => {
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Duplicate items' : 'Duplicate item';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.some(copyAction.canExecute)) return false;

      copyAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.some(copyAction.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Move to folder - 'm'
  registerHotkey({
    hotkey: ['m'],
    hotkeyToken: TOKENS.entity.action.moveToFolder,
    scopeId,
    description: () => {
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Move items to folder' : 'Move to folder';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.some(moveToProjectAction.canExecute)) return false;

      moveToProjectAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.some(moveToProjectAction.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Copy link - 'shift+cmd+c'
  registerHotkey({
    hotkey: ['shift+cmd+c'],
    hotkeyToken: TOKENS.entity.action.copyLink,
    scopeId,
    description: 'Copy link',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!copyLinkAction.canExecute(entities[0])) return false;
      copyLinkAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length === 1 && copyLinkAction.canExecute(entities[0]);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Copy branch name - 'shift+cmd+b'
  registerHotkey({
    hotkey: ['shift+cmd+b'],
    hotkeyToken: TOKENS.entity.action.copyBranchName,
    scopeId,
    description: 'Copy branch name',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!copyBranchNameAction.canExecute(entities[0])) return false;
      copyBranchNameAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length === 1 && copyBranchNameAction.canExecute(entities[0])
      );
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Share
  registerHotkey({
    hotkeyToken: TOKENS.entity.action.share,
    scopeId,
    description: 'Share',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!shareAction.canExecute(entities[0])) return false;
      shareAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length === 1 && isShareableEntityType(entities[0].type);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  onCleanup(() => group.dispose());
};
