import { useBlockId } from '@core/block';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useAllProperties } from '@app/component/property-edit-modal/hooks/useAllProperties';
import { openPropertyEditor } from '@app/component/property-edit-modal/state/propertyEditor';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import type {
  Property,
  PropertyDefinitionDomain,
} from '@core/component/Properties/types';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { CommandState } from '@app/component/command';
import { isTaskEntity, type EntityData } from '@entity';
import { createEffect, onCleanup } from 'solid-js';
import {
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
} from './index';

/**
 * scoped to the current block's hotkey scope.
 *
 * Must be called within a Block context (i.e. inside DocumentBlockContainer / BlockContainer).
 * Uses createEffect to defer registration until BlockContainer has set blockHotkeyScopeSignal.
 */
export const useBlockEntityCommands = () => {
  const blockId = useBlockId();
  const quickAccess = useQuickAccess();
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

  const allProperties = useAllProperties();

  const propertyById = (propertyId: string) =>
    allProperties().find(({ id }) => id === propertyId);

  const status = () => propertyById(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = () => propertyById(SYSTEM_PROPERTY_IDS.PRIORITY);
  const assignees = () => propertyById(SYSTEM_PROPERTY_IDS.ASSIGNEES);

  const getEntity = (): EntityData | undefined => {
    const item = quickAccess.getById(blockId);
    if (item?.kind === 'entity') return item.data;
    return undefined;
  };

  const getEntities = (): EntityData[] => {
    const entity = getEntity();
    return entity ? [entity] : [];
  };

  const openPropertyEditorIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property | PropertyDefinitionDomain
  ) => {
    const entities = getEntities();
    if (entities.length > 0) {
      openPropertyEditor(entities, mode, property);
    }
  };

  createEffect(() => {
    const scopeId = blockHotkeyScopeSignal.get();
    if (!scopeId) return;

    const group = createHotkeyGroup();

    const markDoneReg = registerHotkey({
      scopeId,
      description: 'Mark done',
      keyDownHandler: () => {
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!entities.some(markDone.canExecute)) return false;
        markDone.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return entities.some(markDone.canExecute);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    });

    registerHotkey({
      scopeId,
      description: () => {
        const count = getEntities().length;
        return count > 1 ? 'Delete items' : 'Delete item';
      },
      keyDownHandler: () => {
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!entities.every(deleteAction.canExecute)) return false;
        deleteAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return entities.length > 0 && entities.every(deleteAction.canExecute);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    registerHotkey({
      hotkey: ['r'],
      hotkeyToken: TOKENS.entity.action.rename,
      scopeId,
      description: () => {
        const count = getEntities().length;
        return count > 1 ? 'Rename items' : 'Rename item';
      },
      keyDownHandler: () => {
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!entities.every(renameAction.canExecute)) return false;
        renameAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return entities.length > 0 && entities.every(renameAction.canExecute);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Duplicate - 'cmd+d'
    registerHotkey({
      hotkey: ['cmd+d'],
      hotkeyToken: TOKENS.entity.action.copy,
      scopeId,
      description: () => {
        const count = getEntities().length;
        return count > 1 ? 'Duplicate items' : 'Duplicate item';
      },
      keyDownHandler: () => {
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!entities.some(copyAction.canExecute)) return false;
        copyAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
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
        const count = getEntities().length;
        return count > 1 ? 'Move items to folder' : 'Move to folder';
      },
      keyDownHandler: () => {
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!entities.some(moveToProjectAction.canExecute)) return false;
        moveToProjectAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
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
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!copyLinkAction.canExecute(entities[0])) return false;
        copyLinkAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
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
        const entities = getEntities();
        if (entities.length === 0) return false;
        if (!copyBranchNameAction.canExecute(entities[0])) return false;
        copyBranchNameAction.execute(entities);
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return (
          entities.length === 1 && copyBranchNameAction.canExecute(entities[0])
        );
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Open property selector - 'shift+cmd+o'
    registerHotkey({
      hotkey: ['shift+cmd+o'],
      hotkeyToken: TOKENS.entity.action.properties,
      scopeId,
      description: 'Open property editor',
      keyDownHandler: () => {
        openPropertyEditorIfSelected('selector');
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return entities.length > 0 && entities.every(isTaskEntity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Set priority - 'shift+cmd+p'
    registerHotkey({
      hotkey: ['shift+cmd+p'],
      hotkeyToken: TOKENS.entity.action.priority,
      scopeId,
      description: 'Set priority',
      keyDownHandler: () => {
        openPropertyEditorIfSelected('direct', priority());
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return (
          entities.length > 0 &&
          entities.every(isTaskEntity) &&
          Boolean(priority())
        );
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Set assignee - 'shift+cmd+a'
    registerHotkey({
      hotkey: ['shift+cmd+a'],
      hotkeyToken: TOKENS.entity.action.assignee,
      scopeId,
      description: 'Set assignee',
      keyDownHandler: () => {
        openPropertyEditorIfSelected('direct', assignees());
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return (
          entities.length > 0 &&
          entities.every(isTaskEntity) &&
          Boolean(assignees())
        );
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Set status - 'shift+cmd+s'
    registerHotkey({
      hotkey: ['shift+cmd+s'],
      hotkeyToken: TOKENS.entity.action.status,
      scopeId,
      description: 'Set status',
      keyDownHandler: () => {
        openPropertyEditorIfSelected('direct', status());
        return true;
      },
      condition: () => {
        const entities = getEntities();
        return (
          entities.length > 0 &&
          entities.every(isTaskEntity) &&
          Boolean(status())
        );
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // CMD+K — open entity action mode for this block
    const cmdKReg = registerHotkey({
      scopeId,
      hotkey: 'cmd+k',
      description: () =>
        CommandState.isOpen() ? 'Close command menu' : 'Open command menu',
      condition: () => {
        const entity = getEntity();
        return !CommandState.isOpen() && entity !== undefined;
      },
      keyDownHandler: (e) => {
        e?.preventDefault();
        const entity = getEntity();
        if (entity) {
          CommandState.openForEntityAction([entity]);
        } else {
          CommandState.toggle();
        }
        return true;
      },
      displayPriority: 10,
      handlerPriority: 1,
      hide: CommandState.isOpen,
      runWithInputFocused: true,
    });

    onCleanup(() => {
      markDoneReg.dispose();
      cmdKReg.dispose();
      group.dispose();
    });
  });
};
