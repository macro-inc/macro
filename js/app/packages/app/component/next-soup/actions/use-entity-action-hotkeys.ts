import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { isShareableEntityType } from '@app/component/global-share-modal/GlobalShareModal';
import { canExecuteMarkDoneOnView } from '@app/component/next-soup/actions/make-mark-done-action';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { useAllProperties } from '@app/component/property-edit-modal/hooks/useAllProperties';
import { openPropertyEditor } from '@app/component/property-edit-modal/state/propertyEditor';
import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { isListViewID } from '@app/constants/list-views';
import { useUserId } from '@core/context/user';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { type EntityData, isTaskEntity } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { onCleanup } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import {
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
  makeShareAction,
} from './index';

type UseEntityActionHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  activeSoupViewTab?: () => string | undefined;
  splitHandle?: SplitHandle;
  condition?: () => boolean;
  /** Fallback entity getter used when soup has no selection/focus (e.g., block views) */
  getEntityFallback?: () => EntityData | undefined;
};

export const useEntityActionHotkeys = (
  options: UseEntityActionHotkeysOptions
) => {
  const { scopeId, soup, splitHandle, condition, getEntityFallback } = options;

  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const group = createHotkeyGroup();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
    hotkeyGroup: group,
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

  const copyEntityIdAction = makeCopyEntityIdAction();

  const shareAction = makeShareAction();

  const getEntitiesForAction = (): EntityData[] => {
    if (
      splitHandle?.content().type === 'component' &&
      isListViewID(splitHandle?.content().id)
    ) {
      const selected = soup.selection.selected();
      if (selected.length > 0) return selected;
    }

    const focused = soup.focus.item();
    if (focused) return [focused];

    // Fallback: use provided entity getter (e.g., for block views)
    if (getEntityFallback) {
      const entity = getEntityFallback();
      if (entity) return [entity];
    }

    return [];
  };

  const openNextEntity = (entity: EntityData) => {
    if (!splitHandle) return;
    const handleContent = splitHandle.content().type;
    if (handleContent === 'component' || handleContent === 'project') return;
    openEntityInSplitFromUnifiedList(entity, { splitHandle });
  };

  // Property editor setup
  const allProperties = useAllProperties();
  const propertyById = (propertyId: string) =>
    allProperties().find(({ id }) => id === propertyId);
  const status = () => propertyById(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = () => propertyById(SYSTEM_PROPERTY_IDS.PRIORITY);
  const assignees = () => propertyById(SYSTEM_PROPERTY_IDS.ASSIGNEES);

  const openPropertyEditorIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property | PropertyDefinitionDomain
  ) => {
    const entities = getEntitiesForAction();
    if (entities.length > 0) {
      openPropertyEditor(entities, mode, property);
    }
  };

  // Mark Done - 'e', not included in Hotkey Group so that we can use it from inside of blocks
  registerHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId,
    description: 'Mark done',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(markDone.canExecute)) return false;

      markDone.executeWithSoup(entities, soup, openNextEntity);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;

      const contentId = splitHandle?.content().id;

      const soupViewTab = options.activeSoupViewTab?.();

      if (
        !isListViewID(contentId) ||
        (soupViewTab && !canExecuteMarkDoneOnView(contentId, soupViewTab))
      )
        return false;

      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(markDone.canExecute);
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
      if (!entities.every(copyAction.canExecute)) return false;

      copyAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(copyAction.canExecute);
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
      if (!entities.every(moveToProjectAction.canExecute)) return false;

      moveToProjectAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 && entities.every(moveToProjectAction.canExecute)
      );
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

  // Copy entity id (command menu only, no keybinding)
  registerHotkey({
    hotkeyToken: TOKENS.entity.action.copyEntityId,
    scopeId,
    description: 'Copy ID',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!copyEntityIdAction.canExecute(entities[0])) return false;
      copyEntityIdAction.executeWithSoup(entities, soup);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length === 1 && copyEntityIdAction.canExecute(entities[0])
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

  // Open property selector - shift+cmd+o
  registerHotkey({
    hotkey: ['shift+cmd+o'],
    hotkeyToken: TOKENS.entity.action.properties,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Open property editor',
    keyDownHandler: () => {
      openPropertyEditorIfSelected('selector');
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(isTaskEntity);
    },
    scopeId,
  }).withGroup(group);

  // Set priority - shift+cmd+p
  registerHotkey({
    hotkey: ['shift+cmd+p'],
    hotkeyToken: TOKENS.entity.action.priority,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set priority',
    keyDownHandler: () => {
      openPropertyEditorIfSelected('direct', priority());
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 &&
        entities.every(isTaskEntity) &&
        Boolean(priority())
      );
    },
    scopeId,
  }).withGroup(group);

  // Set assignee - shift+cmd+a
  registerHotkey({
    hotkey: ['shift+cmd+a'],
    hotkeyToken: TOKENS.entity.action.assignee,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set assignee',
    keyDownHandler: () => {
      openPropertyEditorIfSelected('direct', assignees());
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 &&
        entities.every(isTaskEntity) &&
        Boolean(assignees())
      );
    },
    scopeId,
  }).withGroup(group);

  // Set status - shift+cmd+s
  registerHotkey({
    hotkey: ['shift+cmd+s'],
    hotkeyToken: TOKENS.entity.action.status,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: 'Set status',
    keyDownHandler: () => {
      openPropertyEditorIfSelected('direct', status());
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 && entities.every(isTaskEntity) && Boolean(status())
      );
    },
    scopeId,
  }).withGroup(group);

  onCleanup(() => group.dispose());

  return {
    openPropertyEditor: openPropertyEditorIfSelected,
  };
};
