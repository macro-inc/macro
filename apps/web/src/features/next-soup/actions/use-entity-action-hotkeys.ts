import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useAllProperties } from '@app/features/property/editor/hooks/useAllProperties';
import { openPropertyEditor } from '@app/features/property/editor/state/propertyEditor';
import { isShareableEntityType } from '@app/features/sharing/global-share-modal/shareable-entity';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { useUserId } from '@core/context/user';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { type EntityData, isTaskEntity } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { Property, PropertyDefinitionDomain } from '@property/types';
import { type Accessor, onCleanup } from 'solid-js';
import type {
  EntityActionListState,
  EntityActionViewContext,
} from './entity-action-context';
import {
  makeAddTagAction,
  makeCopyAction,
  makeCopyBranchNameAction,
  makeCopyEntityIdAction,
  makeCopyLinkAction,
  makeCreateReminderAction,
  makeDeleteAction,
  makeEditReminderAction,
  makeFavoriteAction,
  makeMarkDoneAction,
  makeMarkNotDoneAction,
  makeMarkReadAction,
  makeMarkUnreadAction,
  makeMoveToProjectAction,
  makeMuteAction,
  makeRenameAction,
  makeSetCompanyPropertyAction,
  makeShareAction,
  markReminderTargetDone,
} from './index';

type UseEntityActionHotkeysOptions = {
  scopeId: string;
  list: EntityActionListState;
  selectedEntities: Accessor<EntityData[]>;
  focusedEntity: Accessor<EntityData | undefined>;
  restoreFocus: (entityId?: string) => void | Promise<void>;
  viewContext: Accessor<EntityActionViewContext>;
  splitHandle?: SplitHandle;
  condition?: () => boolean;
};

export const useEntityActionHotkeys = (
  options: UseEntityActionHotkeysOptions
) => {
  const {
    scopeId,
    list,
    selectedEntities,
    focusedEntity,
    restoreFocus,
    splitHandle,
    condition,
  } = options;

  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const group = createHotkeyGroup();

  const markDone = makeMarkDoneAction({
    userId: () => userId(),
    notificationSource: () => notificationSource,
    hotkeyGroup: group,
  });

  const markNotDone = makeMarkNotDoneAction({
    notificationSource: () => notificationSource,
  });

  const markRead = makeMarkReadAction();
  const markUnread = makeMarkUnreadAction();

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
  const editReminderAction = makeEditReminderAction();

  const shareAction = makeShareAction();

  const favoriteAction = makeFavoriteAction();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });

  const setCompanyPropertyAction = makeSetCompanyPropertyAction();
  const addTagAction = makeAddTagAction();

  const getEntitiesForAction = (): EntityData[] => {
    const selected = selectedEntities();
    if (selected.length > 0) return selected;

    const focused = focusedEntity();
    if (focused) return [focused];

    return [];
  };

  const openNextEntity = (entity: EntityData) => {
    if (!splitHandle) return;
    // Preview Controllers are synchronized centrally by executeWithSoup so
    // every mark-done entry point, including menus and swipe, behaves alike.
    if (splitHandle.isControllerSplit()) return;
    const handleContent = splitHandle.content().type;
    if (handleContent === 'component' || handleContent === 'project') return;
    openEntityInSplitFromUnifiedList(entity, {
      splitHandle,
      mergeHistory: true,
      referredFrom: splitHandle.referredFrom(),
      notificationSource,
    });
  };

  /**
   * Whether this list is one that marks rows done, and so one that moves on to
   * the next row when a row is marked. It gates 'e' below, and the mark-done
   * that follows setting a reminder advances on the same answer.
   */
  const marksDoneOnThisView = (): boolean => {
    return options.viewContext().supportsMarkDone;
  };

  // Declared here rather than with the other actions above because its
  // mark-done follow-up advances the list the same way 'e' does, through
  // `openNextEntity`. Setting a reminder puts the row down: it marks it done,
  // so the list drops it and the reminder is what brings it back.
  const createReminderAction = makeCreateReminderAction({
    onCreated: markReminderTargetDone(markDone, openNextEntity),
  });

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
      openPropertyEditor(entities, mode, property, {
        restoreFocus: () => restoreFocus(entities[0]?.id),
      });
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

      markDone.executeWithSoup(entities, list, openNextEntity);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      if (!marksDoneOnThisView()) return false;

      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(markDone.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Mark as not done - 'shift+e', reverses mark done on archived emails
  registerHotkey({
    hotkey: ['shift+e'],
    hotkeyToken: TOKENS.entity.action.markNotDone,
    scopeId,
    description: 'Mark as not done',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(markNotDone.canExecute)) return false;

      markNotDone.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      if (!marksDoneOnThisView()) return false;

      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(markNotDone.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Mark unread - 'u', read email threads only; rows stay in place
  registerHotkey({
    hotkey: ['u'],
    hotkeyToken: TOKENS.entity.action.markUnread,
    scopeId,
    description: 'Mark unread',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(markUnread.canExecute)) return false;

      markUnread.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(markUnread.canExecute);
    },
    displayPriority: 9,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Mark read - 'shift+u', email selections with at least one unread thread
  registerHotkey({
    hotkey: ['shift+u'],
    hotkeyToken: TOKENS.entity.action.markRead,
    scopeId,
    description: 'Mark read',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.some(markRead.canExecute)) return false;

      markRead.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length > 0 &&
        entities.every((e) => e.type === 'email') &&
        entities.some(markRead.canExecute)
      );
    },
    displayPriority: 9,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

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

      deleteAction.executeWithSoup(entities, list);
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

  /**
   * Whether 'r' should open the reminder editor rather than rename.
   *
   * The two are mutually exclusive rather than merely unlikely to overlap:
   * `renameAction.canExecute` ends at `entity.ownerId === userId()`, and a
   * reminder row's `ownerId` is always `''` while `userId()` is a macro id or
   * undefined — so rename never claims a reminder, and sharing the key beats
   * leaving 'r' dead on one. Its name is its description, which only the
   * reminders API can change.
   */
  const editsReminder = (): boolean => {
    const entities = getEntitiesForAction();
    return entities.length === 1 && editReminderAction.canExecute(entities[0]);
  };

  // Rename - 'r'. Edits the reminder instead when the row is one.
  registerHotkey({
    hotkey: ['r'],
    hotkeyToken: TOKENS.entity.action.rename,
    scopeId,
    description: () => {
      if (editsReminder()) return 'Edit reminder';
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Rename items' : 'Rename item';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;

      if (editsReminder()) {
        editReminderAction.executeWithSoup(entities, list);
        return true;
      }

      if (!entities.every(renameAction.canExecute)) return false;

      renameAction.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      if (editsReminder()) return true;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(renameAction.canExecute);
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
      const entities = getEntitiesForAction();
      const allFavorited =
        entities.length > 0 &&
        entities.every((entity) => favoriteAction.isFavorited(entity));
      return allFavorited ? 'Unfavorite' : 'Favorite';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(favoriteAction.canExecute)) return false;

      favoriteAction.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(favoriteAction.canExecute);
    },
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Mute notifications (command menu only, no keybinding)
  registerHotkey({
    hotkeyToken: TOKENS.entity.action.mute,
    scopeId,
    description: () => {
      const entities = getEntitiesForAction();
      const allMuted =
        entities.length > 0 &&
        entities.every((entity) => muteAction.isMuted(entity));
      return allMuted ? 'Unmute notifications' : 'Mute notifications';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      if (!entities.every(muteAction.canExecute)) return false;

      void muteAction.executeWithSoup(entities, list);
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(muteAction.canExecute);
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

      copyAction.executeWithSoup(entities, list);
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

      moveToProjectAction.executeWithSoup(entities, list);
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
      copyLinkAction.executeWithSoup(entities, list);
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
      copyBranchNameAction.executeWithSoup(entities, list);
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
      copyEntityIdAction.executeWithSoup(entities, list);
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

  // Set a reminder - 'h'. This shares the scope with the list's 'h' ("Collapse
  // item", handlerPriority 4), so 'add' keeps both registered instead of one
  // evicting the other. Collapse sorts first and returns false when there is
  // nothing to collapse, which falls through to here.
  registerHotkey({
    hotkey: ['h'],
    hotkeyToken: TOKENS.entity.action.createReminder,
    scopeId,
    description: 'Remind me',
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length !== 1) return false;
      if (!createReminderAction.canExecute(entities[0])) return false;
      createReminderAction.executeWithSoup(entities, list, {
        advances: marksDoneOnThisView(),
      });
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return (
        entities.length === 1 && createReminderAction.canExecute(entities[0])
      );
    },
    registrationType: 'add',
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
      shareAction.executeWithSoup(entities, list);
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

  // Assign tags - t
  registerHotkey({
    hotkey: ['t'],
    hotkeyToken: TOKENS.entity.action.tags,
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
    description: () => {
      const count = getEntitiesForAction().length;
      return count > 1 ? 'Tag items' : 'Tag item';
    },
    keyDownHandler: () => {
      const entities = getEntitiesForAction();
      if (entities.length === 0) return false;
      addTagAction.execute(entities, {
        restoreFocus: () => restoreFocus(entities[0]?.id),
      });
      return true;
    },
    condition: () => {
      if (condition && !condition()) return false;
      const entities = getEntitiesForAction();
      return entities.length > 0 && entities.every(addTagAction.canExecute);
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

  // Set stage / owner / revenue for CRM companies (command menu only, no
  // keybindings) — company counterpart of the task property commands above.
  const companyPropertyCommands = [
    { token: TOKENS.entity.action.stage, field: 'stage', label: 'Set stage' },
    { token: TOKENS.entity.action.owner, field: 'owner', label: 'Set owner' },
    {
      token: TOKENS.entity.action.revenue,
      field: 'revenue',
      label: 'Set revenue',
    },
  ] as const;
  for (const { token, field, label } of companyPropertyCommands) {
    registerHotkey({
      hotkeyToken: token,
      tags: [HotkeyTags.SelectionModification],
      displayPriority: 10,
      description: label,
      keyDownHandler: () => {
        const entities = getEntitiesForAction();
        if (entities.length === 0) return false;
        if (!entities.every(setCompanyPropertyAction.canExecute)) return false;
        setCompanyPropertyAction.execute(entities, field);
        return true;
      },
      condition: () => {
        if (condition && !condition()) return false;
        const entities = getEntitiesForAction();
        return (
          entities.length > 0 &&
          entities.every(setCompanyPropertyAction.canExecute)
        );
      },
      scopeId,
    }).withGroup(group);
  }

  onCleanup(() => group.dispose());

  return {
    openPropertyEditor: openPropertyEditorIfSelected,
  };
};
