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
 * Common manipulations scoped to the current block's hotkey scope.
 * Note: several of these do not register with an actual hot key so that they
 * can be found by the command menu.
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

  const openPropertyEditorIfSelected = (
    mode: 'selector' | 'direct' = 'selector',
    property?: Property | PropertyDefinitionDomain
  ) => {
    const entity = getEntity();
    if (entity) {
      openPropertyEditor([entity], mode, property);
    }
  };

  createEffect(() => {
    const scopeId = blockHotkeyScopeSignal.get();
    if (!scopeId) return;

    const group = createHotkeyGroup();

    registerHotkey({
      scopeId,
      description: 'Mark done',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!markDone.canExecute(entity)) return false;
        markDone.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && markDone.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    registerHotkey({
      scopeId,
      description: 'Delete item',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!deleteAction.canExecute(entity)) return false;
        deleteAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && deleteAction.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    registerHotkey({
      hotkey: ['r'],
      hotkeyToken: TOKENS.entity.action.rename,
      scopeId,
      description: 'Rename item',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!renameAction.canExecute(entity)) return false;
        renameAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && renameAction.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    registerHotkey({
      scopeId,
      description: 'Duplicate item',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!copyAction.canExecute(entity)) return false;
        copyAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && copyAction.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Move to folder - 'm'
    registerHotkey({
      hotkey: ['m'],
      hotkeyToken: TOKENS.entity.action.moveToFolder,
      scopeId,
      description: 'Move to folder',
      keyDownHandler: (e) => {
        const entity = getEntity();
        if (!entity) return false;
        e?.AT_TARGET;
        if (!moveToProjectAction.canExecute(entity)) return false;
        moveToProjectAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && moveToProjectAction.canExecute(entity);
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
        const entity = getEntity();
        if (!entity) return true;
        if (!copyLinkAction.canExecute(entity)) return true;
        copyLinkAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && copyLinkAction.canExecute(entity);
      },
      displayPriority: 10,
      runWithInputFocused: true,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Copy branch name - 'shift+cmd+b'
    registerHotkey({
      hotkey: ['shift+cmd+b'],
      hotkeyToken: TOKENS.entity.action.copyBranchName,
      scopeId,
      description: 'Copy branch name',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!copyBranchNameAction.canExecute(entity)) return false;
        copyBranchNameAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && copyBranchNameAction.canExecute(entity);
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
        const entity = getEntity();
        return entity !== undefined && isTaskEntity(entity);
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
        const entity = getEntity();
        return (
          entity !== undefined && isTaskEntity(entity) && Boolean(priority())
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
        const entity = getEntity();
        return (
          entity !== undefined && isTaskEntity(entity) && Boolean(assignees())
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
        const entity = getEntity();
        return (
          entity !== undefined && isTaskEntity(entity) && Boolean(status())
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
      cmdKReg.dispose();
      group.dispose();
    });
  });
};
