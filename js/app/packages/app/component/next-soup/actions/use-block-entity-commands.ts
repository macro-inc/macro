import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useMaybeSoup } from '@app/component/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { useAllProperties } from '@app/component/property-edit-modal/hooks/useAllProperties';
import { openPropertyEditor } from '@app/component/property-edit-modal/state/propertyEditor';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { type EntityData, isTaskEntity } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { createEffect, onCleanup } from 'solid-js';
import {
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeDeleteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeRenameAction,
} from './index';

/**
 * Common manipulations scoped to the current block.
 * This should be called and mounted
 * Note: several of these do not register with an actual hot key so that they
 * can be found by the command menu.
 */
export const useBlockEntityCommands = () => {
  const blockId = useBlockId();
  const quickAccess = useQuickAccess();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const soup = useMaybeSoup();
  const splitPanel = useSplitPanel();
  const previewPanel = useMaybePreviewPanel();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
  });

  const deleteAction = makeDeleteAction({ userId: () => userId() });
  const renameAction = makeRenameAction({ userId: () => userId() });
  const copyAction = makeCopyAction();
  const moveToProjectAction = makeMoveToProjectAction();
  const copyLinkAction = makeCopyLinkAction();
  const copyBranchNameAction = makeCopyBranchNameAction();
  const copyEntityIdAction = makeCopyEntityIdAction();

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

  // The 'e' hotkey from inside a block is reserved for entities opened full
  // screen from the inbox/mail lists, mirroring the j/k gating in
  // use-soup-navigation-hotkeys. Blocks rendered in the preview panel fall
  // through to the originating list's own 'e' registration.
  const canUseMarkDoneHotkey = () => {
    if (previewPanel) return false;
    const referredFrom = splitPanel?.handle.referredFrom();
    return referredFrom === 'inbox' || referredFrom === 'mail';
  };

  const runMarkDone = () => {
    const entity = getEntity();
    if (!entity) return false;
    if (!markDone.canExecute(entity)) return false;

    // Plain mark done, no advance: the command-menu registration outside the
    // triage flow, or the entity is no longer in the surviving soup list.
    const selectedRow = soup?.items.get(entity.id);
    if (!canUseMarkDoneHotkey() || !soup || !selectedRow) {
      markDone.execute([entity]);
      return true;
    }

    // Triage flow: mark done and advance to the next item in the list.
    markDone.executeWithSoup([selectedRow.original], soup, (nextEntity) => {
      const splitHandle = splitPanel?.handle;
      if (!splitHandle) return;
      void openEntityInSplitFromUnifiedList(nextEntity, {
        splitHandle,
        mergeHistory: true,
        referredFrom: splitHandle.referredFrom(),
      });
    });

    return true;
  };

  createEffect(() => {
    const scopeId = blockHotkeyScopeSignal.get();
    if (!scopeId) return;

    const group = createHotkeyGroup();

    // Mark done - 'e', only when coming from the inbox or mail views
    registerHotkey({
      hotkey: ['e'],
      hotkeyToken: TOKENS.entity.action.markDone,
      scopeId,
      description: 'Mark done',
      keyDownHandler: runMarkDone,
      condition: () => {
        if (!canUseMarkDoneHotkey()) return false;
        const entity = getEntity();
        return entity !== undefined && markDone.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Mark done without a keybinding everywhere else, so it stays reachable
    // from the command menu
    registerHotkey({
      scopeId,
      description: 'Mark done',
      keyDownHandler: runMarkDone,
      condition: () => {
        if (canUseMarkDoneHotkey()) return false;
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

    // Copy entity id (command menu only, no keybinding)
    registerHotkey({
      hotkeyToken: TOKENS.entity.action.copyEntityId,
      scopeId,
      description: 'Copy ID',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!copyEntityIdAction.canExecute(entity)) return false;
        copyEntityIdAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && copyEntityIdAction.canExecute(entity);
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

    onCleanup(() => {
      group.dispose();
    });
  });
};
