import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  restoreSoupFocus,
} from '@app/features/next-soup/utils';
import { useAllProperties } from '@app/features/property/editor/hooks/useAllProperties';
import { openPropertyEditor } from '@app/features/property/editor/state/propertyEditor';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { useQuickAccess } from '@core/context/quickAccess';
import { useUserId } from '@core/context/user';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { type EntityData, isDocumentEntity, isTaskEntity } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { createEffect, onCleanup } from 'solid-js';
import {
  makeAddTagAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeDeleteAction,
  makeFavoriteAction,
  makeMarkDoneAction,
  makeMoveToProjectAction,
  makeMuteAction,
  makeRenameAction,
  markReminderTargetDone,
} from './index';

/**
 * Common manipulations scoped to the current block.
 * This should be called and mounted
 * Note: several of these do not register with an actual hot key so that they
 * can be found by the command menu.
 *
 * `resolveEntity` lets a block supply its own entity for blocks quick access
 * cannot resolve. Quick access is built from history, channels, users, companies
 * and snippets — email threads appear in none of them, so without an override
 * `getEntity` returns undefined there and every command below silently drops
 * out of the command menu. Blocks that pass one must use a non-suspending
 * source: `condition()` runs inside command-menu evaluation, where a pending
 * query must not suspend.
 */
export const useBlockEntityCommands = (
  resolveEntity?: () => EntityData | undefined
) => {
  const blockId = useBlockId();
  const quickAccess = useQuickAccess();
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();
  const soup = useMaybeSoup();
  const splitPanel = useSplitPanel();

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
  const favoriteAction = makeFavoriteAction();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const addTagAction = makeAddTagAction();

  const allProperties = useAllProperties();

  const propertyById = (propertyId: string) =>
    allProperties().find(({ id }) => id === propertyId);

  const status = () => propertyById(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = () => propertyById(SYSTEM_PROPERTY_IDS.PRIORITY);
  const assignees = () => propertyById(SYSTEM_PROPERTY_IDS.ASSIGNEES);

  const getEntity = (): EntityData | undefined => {
    const provided = resolveEntity?.();
    if (provided) return provided;
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
      openPropertyEditor([entity], mode, property, {
        restoreFocus: () => {
          if (soup) return restoreSoupFocus(entity.id);
        },
      });
    }
  };
  // The 'e' hotkey from inside a block is reserved for entities opened from
  // the inbox/mail lists, mirroring the j/k gating in
  // use-soup-navigation-hotkeys.
  const canUseMarkDoneHotkey = () => {
    const referredFrom = splitPanel?.handle.referredFrom();
    return referredFrom === 'inbox' || referredFrom === 'mail';
  };

  // The canvas block binds 'h' to its hand tool in this same scope
  // (CanvasController). Canvas keeps the key; the reminder falls back to its
  // command-menu-only registration there so no shortcut is advertised that the
  // hand tool would swallow.
  const canUseReminderHotkey = () => {
    const entity = getEntity();
    return !(
      entity &&
      isDocumentEntity(entity) &&
      entity.fileType === 'canvas'
    );
  };

  /** Follows the list's next row into this split, as the triage flow does. */
  const advanceSplitTo = (nextEntity: EntityData) => {
    const splitHandle = splitPanel?.handle;
    if (!splitHandle) return;
    void openEntityInSplitFromUnifiedList(nextEntity, {
      splitHandle,
      mergeHistory: true,
      referredFrom: splitHandle.referredFrom(),
      notificationSource,
    });
  };

  // Setting a reminder puts the entity down: it marks it done, so it leaves the
  // list behind this block and the reminder is what brings it back. Declared
  // after `advanceSplitTo` so the follow-up advances exactly as 'e' does.
  const createReminderAction = makeCreateReminderAction({
    onCreated: markReminderTargetDone(markDone, advanceSplitTo),
  });

  /**
   * The soup row for the entity when this block is being triaged out of a list,
   * which is what decides between advancing the split and leaving it be.
   */
  const triageRow = () => {
    const entity = getEntity();
    if (!entity || !canUseMarkDoneHotkey() || !soup) return undefined;
    return soup.items.get(entity.id);
  };

  const runCreateReminder = () => {
    const entity = getEntity();
    if (!entity) return false;
    if (!createReminderAction.canExecute(entity)) return false;

    // Driven through soup when the block is being triaged out of a list. Having
    // a `triageRow` is the same condition 'e' advances on, so the mark-done
    // that follows moves to the next row exactly as Mark done does rather than
    // leaving the split on one the list has dropped.
    const selectedRow = triageRow();
    if (soup && selectedRow) {
      void createReminderAction.executeWithSoup([selectedRow.original], soup, {
        advances: true,
      });
      return true;
    }

    createReminderAction.execute([entity]);
    return true;
  };

  const runMarkDone = () => {
    const entity = getEntity();
    if (!entity) return false;
    if (!markDone.canExecute(entity)) return false;

    // Plain mark done, no advance: the command-menu registration outside the
    // triage flow, or the entity is no longer in the surviving soup list.
    const selectedRow = triageRow();
    if (!soup || !selectedRow) {
      markDone.execute([entity]);
      return true;
    }

    // Triage flow: mark done and advance to the next item in the list.
    markDone.executeWithSoup([selectedRow.original], soup, advanceSplitTo);

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

    // Favorite - 'opt+f' (macOS emits 'ƒ'; normalizeEventKeyPress maps it back to 'f')
    registerHotkey({
      hotkey: ['opt+f'],
      hotkeyToken: TOKENS.entity.action.favorite,
      scopeId,
      description: () => {
        const entity = getEntity();
        return entity && favoriteAction.isFavorited(entity)
          ? 'Unfavorite'
          : 'Favorite';
      },
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!favoriteAction.canExecute(entity)) return false;
        favoriteAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && favoriteAction.canExecute(entity);
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Mute notifications (command menu only, no keybinding)
    registerHotkey({
      hotkeyToken: TOKENS.entity.action.mute,
      scopeId,
      description: () => {
        const entity = getEntity();
        return entity && muteAction.isMuted(entity)
          ? 'Unmute notifications'
          : 'Mute notifications';
      },
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        if (!muteAction.canExecute(entity)) return false;
        void muteAction.execute([entity]);
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && muteAction.canExecute(entity);
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

    // Copy entity id (command menu only, no keybinding). Deliberately not
    // gated on getEntity(): a block is keyed by its entity id, and Quick
    // Access — a recents cache built from history, channels, contacts,
    // companies and snippets — has no entry for entity types it never indexes
    // (emails, calls) or for an item created moments ago. Requiring the entity
    // hid Copy ID on exactly those blocks, and since it has no keybinding the
    // command menu is the only way to reach it.
    registerHotkey({
      hotkeyToken: TOKENS.entity.action.copyEntityId,
      scopeId,
      description: 'Copy ID',
      keyDownHandler: () => {
        copyEntityIdAction.executeById(blockId);
        return true;
      },
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Set a reminder - 'h'. 'add' rather than the default 'override', so this
    // and the canvas hand tool coexist in the scope instead of whichever
    // registered last evicting the other.
    registerHotkey({
      hotkey: ['h'],
      hotkeyToken: TOKENS.entity.action.createReminder,
      scopeId,
      description: 'Remind me',
      keyDownHandler: runCreateReminder,
      condition: () => {
        if (!canUseReminderHotkey()) return false;
        const entity = getEntity();
        return entity !== undefined && createReminderAction.canExecute(entity);
      },
      registrationType: 'add',
      displayPriority: 10,
      tags: [HotkeyTags.SelectionModification],
    }).withGroup(group);

    // Set a reminder without a keybinding on canvas, so it stays reachable
    // from the command menu
    registerHotkey({
      scopeId,
      description: 'Remind me',
      keyDownHandler: runCreateReminder,
      condition: () => {
        if (canUseReminderHotkey()) return false;
        const entity = getEntity();
        return entity !== undefined && createReminderAction.canExecute(entity);
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

    // Assign tags - 't'
    registerHotkey({
      hotkey: ['t'],
      hotkeyToken: TOKENS.entity.action.tags,
      scopeId,
      description: 'Tag item',
      keyDownHandler: () => {
        const entity = getEntity();
        if (!entity) return false;
        addTagAction.execute([entity], {
          restoreFocus: () => {
            if (soup) return restoreSoupFocus(entity.id);
          },
        });
        return true;
      },
      condition: () => {
        const entity = getEntity();
        return entity !== undefined && addTagAction.canExecute(entity);
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
