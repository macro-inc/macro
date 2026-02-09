import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { HotkeyTags } from '@core/hotkey/constants';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@macro-entity';
import type { SoupState } from '../create-soup-state';
import {
  makeCopyAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
} from './index';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';

type UseEntityActionHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  condition?: () => boolean;
};

export const useEntityActionHotkeys = (
  options: UseEntityActionHotkeysOptions
) => {
  const { scopeId, soup, condition } = options;

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

  const getEntitiesForAction = (): EntityData[] => {
    const selected = soup.selection.selected();
    if (selected.length > 0) return selected;

    const focused = soup.focus.item();
    return focused ? [focused] : [];
  };

  // Mark Done - 'e'
  registerHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId,
    description: 'Mark done',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.some(markDone.canExecute)) return false;

      markDone.executeWithSoup(entities, soup);
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
  });

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
  });

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
  });

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
  });
};
