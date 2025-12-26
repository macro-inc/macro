import { globalSplitManager } from '@app/signal/splitLayout';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { ENABLE_PROPERTIES_METADATA } from '@core/constant/featureFlags';
import { HotkeyTags } from '@core/hotkey/constants';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { runCommand } from '@core/hotkey/utils';
import { DEFAULT_VIEWS, type DefaultView, type ViewId } from '@core/types/view';
import { getActualTarget } from '@core/util/getActualTarget';
import { isInteractiveElement } from '@core/util/isInteractiveElement';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import { getScrollParent } from '@core/util/scrollParent';
import { scrollToKeepGap } from '@core/util/scrollToKeepGap';
import { waitForFrames } from '@core/util/sleep';
import { type EntityData, isTaskEntity } from '@macro-entity';
import { entityHasUnreadNotifications } from '@notifications';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';
import { useTutorialCompleted } from '@service-gql/client';
import {
  type PropertiesEntityType,
  propertiesServiceClient,
} from '@service-properties/client';
import { storageServiceClient } from '@service-storage/client';
import { createLazyMemo } from '@solid-primitives/memo';
import { useQuery } from '@tanstack/solid-query';
import type { Virtualizer } from '@tanstack/solid-virtual';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Setter,
  type Signal,
} from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import { ENTITY_HEIGHT } from '../../macro-entity/src/components/EntityWithEverything';
import { useUserId } from '../../macro-entity/src/queries/auth';
import { createBulkCopyDssEntityMutation } from '../../macro-entity/src/queries/dss';
import { playSound } from '../util/sound';
import { openBulkEditModal } from './bulk-edit-entity/BulkEditEntityModal';
import {
  resetCommandCategoryIndex,
  searchCategories,
  setCommandCategoryIndex,
  setKonsoleContextInformation,
} from './command/KonsoleItem';
import {
  konsoleOpen,
  resetKonsoleMode,
  setKonsoleMode,
  toggleKonsoleVisibility,
} from './command/state';
import { useGlobalNotificationSource } from './GlobalAppState';
import type { SplitHandle } from './split-layout/layoutManager';
import { globalRemoveFromSplitHistory } from './split-layout/layoutUtils';
import {
  createEntityActionRegistry,
  type EntityActionRegistry,
} from './UnifiedEntityActions';
import {
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS,
  VIEWCONFIG_DEFAULTS_IDS,
  type ViewConfigBase,
  type ViewConfigEnhanced,
  type ViewData,
  type ViewDataMap,
} from './ViewConfig';

type NavigateListFn = (input: NavigationInput) => Promise<NavigationResult>;

export type UnifiedListContext = {
  viewsDataStore: Store<ViewDataMap>;
  setViewDataStore: SetStoreFunction<Partial<ViewDataMap>>;
  selectedView: Accessor<ViewId>;
  setSelectedView: Setter<ViewId>;
  virtualizerHandleSignal: Signal<Virtualizer<Element, Element> | undefined>;
  entityListRefSignal: Signal<HTMLDivElement | undefined>;
  entitiesSignal: Signal<EntityData[] | undefined>;
  emailViewSignal: Signal<PreviewViewStandardLabel>;
  showHelpDrawer: Accessor<Set<DefaultView>>;
  setShowHelpDrawer: Setter<Set<DefaultView>>;
  actionRegistry: EntityActionRegistry;
  navigateThroughList: NavigateListFn;
  // this is a private method that should be registered once by createNavigationEntityListShortcut
  _setNavigateThroughList: (fn: NavigateListFn) => void;
};

export function createStubSoupContext(): UnifiedListContext {
  return {
    viewsDataStore: createStore({})[0],
    setViewDataStore: () => {},
    selectedView: () => '',
    setSelectedView: () => {},
    virtualizerHandleSignal: createSignal(),
    entityListRefSignal: createSignal(),
    entitiesSignal: createSignal(),
    emailViewSignal: createSignal<PreviewViewStandardLabel>('all'),
    showHelpDrawer: () => new Set(),
    setShowHelpDrawer: () => {},
    actionRegistry: createEntityActionRegistry(),
    navigateThroughList: async () => ({
      success: false,
      type: '',
      entity: undefined,
    }),
    _setNavigateThroughList: () => {},
  };
}

const DEFAULT_VIEW_ID: DefaultView = 'signal';

const DEFAULT_VIEW_IDS_SET = new Set(VIEWCONFIG_DEFAULTS_IDS);

export function createSoupContext(): UnifiedListContext {
  const [selectedView, setSelectedView] = createSignal<ViewId>(DEFAULT_VIEW_ID);
  const [viewsDataStore, setViewDataStore] = useAllViews({
    selectedViewSignal: [selectedView, setSelectedView],
  });
  const virtualizerHandleSignal = createSignal<Virtualizer<Element, Element>>();
  const entityListRefSignal = createSignal<HTMLDivElement>();
  const entitiesSignal = createSignal<EntityData[]>();
  const emailViewSignal = createSignal<PreviewViewStandardLabel>('inbox');
  const tutorialCompleted = useTutorialCompleted();
  const [showHelpDrawer, setShowHelpDrawer] = createSignal<Set<DefaultView>>(
    !tutorialCompleted() ? new Set(DEFAULT_VIEWS) : new Set()
  );
  let navigateThroughListFn: NavigateListFn | undefined;

  return {
    viewsDataStore,
    setViewDataStore,
    selectedView,
    setSelectedView,
    virtualizerHandleSignal,
    entityListRefSignal,
    entitiesSignal,
    emailViewSignal,
    showHelpDrawer,
    setShowHelpDrawer,
    actionRegistry: createEntityActionRegistry(),
    navigateThroughList: (input) => {
      if (!navigateThroughListFn) {
        throw new Error('navigateThroughList not initialized');
      }
      return navigateThroughListFn(input);
    },
    _setNavigateThroughList: (fn) => {
      if (navigateThroughListFn) {
        console.warn('navigateThroughList already initialized');
      }
      navigateThroughListFn = fn;
    },
  };
}

function createViewData(
  view: DefaultView,
  viewProps?: Omit<ViewConfigEnhanced, 'id'> &
    Partial<Pick<ViewConfigEnhanced, 'id'>>
): ViewData {
  return {
    id: (viewProps?.id || view) ?? '',
    view: viewProps?.view ?? view,
    filters: {
      notificationFilter:
        viewProps?.filters?.notificationFilter ??
        VIEWCONFIG_BASE.filters.notificationFilter,
      importantFilter:
        viewProps?.filters?.importantFilter ??
        VIEWCONFIG_BASE.filters.importantFilter,
      documentTypeFilter:
        viewProps?.filters?.documentTypeFilter ??
        VIEWCONFIG_BASE.filters.documentTypeFilter,
      typeFilter:
        viewProps?.filters?.typeFilter ?? VIEWCONFIG_BASE.filters.typeFilter,
      projectFilter:
        viewProps?.filters?.projectFilter ??
        VIEWCONFIG_BASE.filters.projectFilter,
      fromFilter:
        viewProps?.filters?.fromFilter ??
        VIEWCONFIG_BASE.filters.fromFilter ??
        [],
    },
    display: {
      layout: viewProps?.display?.layout ?? VIEWCONFIG_BASE.display.layout,
      showUnreadIndicator:
        viewProps?.display?.showUnreadIndicator ??
        VIEWCONFIG_BASE.display.showUnreadIndicator,
      unrollNotifications:
        viewProps?.display?.unrollNotifications ??
        VIEWCONFIG_BASE.display.unrollNotifications,
      displayProperties:
        viewProps?.display?.displayProperties ??
        VIEWCONFIG_BASE.display.displayProperties,
      limit: viewProps?.display?.limit,
    },
    sort: viewProps?.sort ?? VIEWCONFIG_BASE.sort,
    selectedEntity: undefined,
    scrollOffset: undefined,
    initialConfig: undefined,
    multiSelectEntities: [],
    hasUserInteractedEntity: false,
    searchText: viewProps?.searchText,
  };
}

export type NavigationInput = {
  axis: 'start' | 'end'; // movement direction
  mode: 'step' | 'jump'; // how far: one step or to the end
};

export type NavigationResult = {
  success: boolean;
  entity: EntityData | undefined;
};

export function createNavigationEntityListShortcut({
  splitHandle,
  splitHotkeyScope,
  unifiedListContext,
  previewState,
  getSplitCount,
}: {
  splitHandle: SplitHandle;
  splitHotkeyScope: string;
  unifiedListContext: UnifiedListContext;
  previewState: Signal<boolean>;
  getSplitCount: () => number;
}) {
  const {
    viewsDataStore: viewsData,
    setViewDataStore,
    entityListRefSignal: [entityListRef],
    virtualizerHandleSignal: [virtualizerHandle],
    selectedView,
    setSelectedView,
    entitiesSignal: [entities],
    actionRegistry,
  } = unifiedListContext;
  const viewData = createMemo(() => viewsData[selectedView()]);
  const viewIds = createMemo<ViewId[]>(() => Object.keys(viewsData));

  const [attachEntityHotkeys, _entityHotkeyScope] = useHotkeyDOMScope('entity');
  const selectedEntity = () => viewData().selectedEntity;

  const setSelectedEntity = (entity: EntityData | undefined) => {
    setViewDataStore(
      selectedView(),
      produce((state) => {
        if (!state) return;
        state.selectedEntity = entity;
      })
    );
  };

  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const isViewingList = createMemo(() => {
    return splitHandle.content().id === 'unified-list';
  });
  let lastMultiNavigationInput: NavigationInput;

  // `gg` to jump to top of list (legacy behavior) via command-scope hotkeys.
  const goScope = registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'g',
    description: 'Go',
    keyDownHandler: () => true,
    activateCommandScope: true,
    hide: true,
  });

  registerHotkey({
    hotkey: ['g'],
    scopeId: goScope.commandScopeId,
    description: 'Go to top of list',
    condition: isViewingList,
    keyDownHandler: () => {
      navigateThroughList({ axis: 'start', mode: 'jump' });
      return true;
    },
    hide: true,
  });

  registerHotkey({
    hotkey: ['shift+g', 'end'],
    scopeId: goScope.commandScopeId,
    description: 'Go to bottom of list',
    condition: isViewingList,
    keyDownHandler: () => {
      navigateThroughList({ axis: 'end', mode: 'jump' });
      return true;
    },
    hide: true,
  });

  /**
   * From the current selection, get the entity to try to select after a modal
   * edit operation.
   */
  const getNextEntity = (
    entitiesForAction: EntityData[]
  ): EntityData | null => {
    const entityList = entities();
    if (!entityList) return null;
    const idToIndexMap = new Map(entityList.map(({ id }, i) => [id, i]));
    let maxIndex = 0;
    for (const entity of entitiesForAction) {
      const ndx = idToIndexMap.get(entity.id);
      if (ndx && ndx > maxIndex) {
        maxIndex = ndx;
      }
    }
    return maxIndex < entityList.length - 1 ? entityList[maxIndex + 1] : null;
  };

  /**
   * Return to list after entity modal edit action.
   */
  const afterEntityAction = (
    entity: EntityData | null | undefined,
    clearSelection?: boolean
  ) => {
    const virtualizer = virtualizerHandle();
    const virtualItems = virtualizer?.getVirtualItems() || [];
    if (clearSelection) {
      setViewDataStore(selectedView(), 'multiSelectEntities', []);
    }
    if (entity) {
      setSelectedEntity(entity);
      const nextIndex = entities()?.findIndex(({ id }) => id === entity.id);
      if (nextIndex !== undefined && nextIndex > -1) {
        const start = virtualItems[0]?.index;
        const end = virtualItems.at(-1)?.index ?? 0;

        if (nextIndex < start) {
          virtualizer?.scrollToIndex(nextIndex, { align: 'start' });
        } else if (nextIndex > end) {
          virtualizer?.scrollToIndex(nextIndex, { align: 'end' });
        }
        waitForFrames(2).then(() => {
          const elem = getEntityElAtIndex(nextIndex);
          if (elem instanceof HTMLElement) {
            elem.focus();
            return;
            // TODO: cooked state (no focus returned - have not yet seen tho)
          }
        });
      } else {
        const firstIndex = virtualItems.at(0)?.index;
        if (!firstIndex) return;
        const elem = getEntityElAtIndex(firstIndex);
        if (elem instanceof HTMLElement) elem.focus();
        // TODO: cooked state (no focus returned - have not yet seen tho)
      }
    }
  };

  // ---------------------------------------------------------------------------
  // MARK AS DONE
  // ---------------------------------------------------------------------------

  // Helper to get the correct properties entity type for an entity
  // Tasks have type 'document' but subType 'task', so we need special handling
  const getPropertiesEntityType = (
    entity: EntityData
  ): PropertiesEntityType | undefined => {
    if (isTaskEntity(entity)) return 'TASK';
    if (entity.type === 'email') return 'THREAD';
    if (entity.type === 'document') return 'DOCUMENT';
    if (entity.type === 'project') return 'PROJECT';
    return undefined;
  };

  actionRegistry.register(
    'mark_as_done',
    async (multiSelectEntities) => {
      const handler =
        VIEWCONFIG_DEFAULTS[selectedView() as DefaultView]?.hotkeyOptions?.e;

      const hasSupportedEntity = multiSelectEntities.some(
        (entity) => getPropertiesEntityType(entity) !== undefined
      );

      if (handler || hasSupportedEntity) {
        if (multiSelectEntities.length > 1) {
          const selectedEntityData = getSelectedEntity();
          const selectedEntityIncludedInMultiSelectedEntities =
            multiSelectEntities.find(
              (entity) => selectedEntityData?.entity.id === entity.id
            );

          // update selected entity to current selected entity's neighbor, before/after neighbor is based on last navigation direction.
          // if selected entity is not from multi selected list, don't update selected entity
          if (selectedEntityIncludedInMultiSelectedEntities) {
            const index = selectedEntityData?.index ?? 0;

            const newSelectedEntity = entities()?.at(index);
            setSelectedEntity(newSelectedEntity);

            navigateThroughList({
              axis: lastMultiNavigationInput.axis,
              mode: 'step',
            });
          }
        } else {
          if (isEntityLastItem()) {
            navigateThroughList({ axis: 'start', mode: 'step' });
          } else {
            navigateThroughList({ axis: 'end', mode: 'step' });
          }
        }

        for (const entity of multiSelectEntities) {
          if (handler) {
            handler(entity, {
              soupContext: unifiedListContext,
              notificationSource,
            });
          }
          const entityType = getPropertiesEntityType(entity);
          if (entityType && ENABLE_PROPERTIES_METADATA) {
            propertiesServiceClient
              .setPropertyStatusComplete({
                entity_type: entityType,
                entity_id: entity.id,
              })
              .catch((err) =>
                console.error('Failed to set status complete', err)
              );
          }
        }

        setViewDataStore(selectedView(), 'multiSelectEntities', []);
      }

      return { success: true };
    },
    {
      canExecute: (entity) => {
        // notifications
        if (entity.type === 'email' || entity.type === 'channel') return true;

        // property status complete (tasks have type 'document' with subType 'task')
        if (isTaskEntity(entity)) return true;
        if (['document', 'project'].includes(entity.type)) return true;

        if (entityHasUnreadNotifications(notificationSource, entity)) {
          return true;
        }
        return false;
      },
    }
  );

  registerEntityHotkey({
    hotkey: ['e'],
    hotkeyToken: TOKENS.entity.action.markDone,
    scopeId: splitHotkeyScope,
    description: 'Mark done',
    keyDownHandler: () => {
      const entitiesForAction = getEntitiesForAction();
      if (entitiesForAction.entities.length === 0) {
        return false;
      }

      actionRegistry.execute(
        'mark_as_done',
        entitiesForAction.entities.map(({ entity }) => entity)
      );

      return true;
    },
    canExecuteKeyDownHandler: () =>
      isViewingList() &&
      actionRegistry.isActionEnabled('mark_as_done', plainSelectedEntities()),
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  });

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    'delete',
    async (entitiesToDelete) => {
      const prev = selectedEntity();
      const next = getNextEntity(entitiesToDelete);
      try {
        openBulkEditModal({
          view: 'delete',
          entities: entitiesToDelete,
          onFinish: () => {
            afterEntityAction(next, true);
            const splitManager = globalSplitManager();
            if (splitManager) {
              const entityIdSet = new Set(entitiesToDelete.map(({ id }) => id));
              globalRemoveFromSplitHistory(splitManager, (entry) =>
                entityIdSet.has(entry.id)
              );
            }
          },
          onCancel: () => {
            afterEntityAction(prev);
          },
        });
      } catch (err) {
        console.error('Failed to open bulk delete modal', err);
      }
      return { success: true };
    },
    {
      canExecute: (entity) => {
        // can't delete these bad boys yet.
        if (entity.type === 'channel' || entity.type === 'email') return false;
        // only delete what you own.
        return entity.ownerId === userId();
      },
      // TODO (seamus): fix the handler from the modal so that we can delete
      // some of the items. Then switch this to some.
      mode: 'every',
    }
  );

  registerEntityHotkey({
    hotkey: ['delete', 'backspace'],
    hotkeyToken: TOKENS.entity.action.delete,
    scopeId: splitHotkeyScope,
    description: () =>
      viewData().multiSelectEntities.length > 1
        ? 'Delete items'
        : 'Delete item',
    keyDownHandler: () => {
      const entitiesForAction = getEntitiesForAction();
      if (entitiesForAction.entities.length === 0) {
        return false;
      }
      actionRegistry.execute(
        'delete',
        entitiesForAction.entities.map(({ entity }) => entity)
      );
      return true;
    },
    canExecuteKeyDownHandler: () =>
      isViewingList() &&
      actionRegistry.isActionEnabled('delete', plainSelectedEntities()),

    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
  });

  createEffect(() => {
    const ref = entityListRef();
    if (!ref) return;

    attachEntityHotkeys(ref);
  });

  // ---------------------------------------------------------------------------
  // RENAME
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    'rename',
    async (entitiesToRename) => {
      const prev = selectedEntity();
      const next = getNextEntity(entitiesToRename);
      try {
        openBulkEditModal({
          view: 'rename',
          entities: entitiesToRename,
          onFinish: () => {
            afterEntityAction(next);
          },
          onCancel: () => {
            afterEntityAction(prev);
          },
        });
      } catch (err) {
        console.error('Failed to open bulk rename modal', err);
      }
      return { success: true };
    },
    {
      canExecute: (entity) => {
        if (entity.type === 'channel') {
          if (entity.channelType === 'direct_message') return false;

          const currentUserId = userId();
          if (!currentUserId) return false;

          // Check if user is the owner
          if (entity.ownerId === currentUserId) {
            return true;
          }

          // Check if user is an admin by looking up channel participant data
          try {
            const channelsContext = useChannelsContext();
            const channel = channelsContext
              .channels()
              .find((c) => c.id === entity.id);
            if (channel) {
              const participant = channel.participants.find(
                (p) => p.user_id === currentUserId
              );
              if (
                participant &&
                ['admin', 'owner'].includes(participant.role)
              ) {
                return true;
              }
            }
          } catch (_err) {
            return false;
          }

          return false;
        }
        if (entity.type === 'email') return false;

        // only rename what you own.
        return entity.ownerId === userId();
      },
    }
  );

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.action.rename,
    description: () =>
      viewData().multiSelectEntities.length > 1
        ? 'Rename items'
        : 'Rename item',
    condition: () =>
      isViewingList() &&
      actionRegistry.isActionEnabled('rename', plainSelectedEntities()),
    keyDownHandler: () => {
      const entitiesForAction = getEntitiesForAction();
      if (entitiesForAction.entities.length === 0) {
        return false;
      }
      actionRegistry.execute(
        'rename',
        entitiesForAction.entities.map(({ entity }) => entity)
      );
      return true;
    },
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
  });

  // ---------------------------------------------------------------------------
  // COPY
  // ---------------------------------------------------------------------------
  const bulkCopyMutation = createBulkCopyDssEntityMutation();
  actionRegistry.register(
    'copy',
    async (entitiesToCopy) => {
      try {
        await bulkCopyMutation.mutateAsync({
          entities: entitiesToCopy,
          name: (name) => name,
        });
      } catch (_) {}
      return { success: true };
    },
    {
      canExecute: (entity) => {
        if (entity.type === 'channel' || entity.type === 'email') return false;
        return true;
      },
    }
  );

  registerHotkey({
    scopeId: splitHotkeyScope,

    hotkeyToken: TOKENS.entity.action.copy,
    description: () =>
      viewData().multiSelectEntities.length > 1 ? 'Copy items' : 'Copy item',
    condition: () =>
      isViewingList() &&
      actionRegistry.isActionEnabled('copy', plainSelectedEntities()),
    keyDownHandler: () => {
      const entitiesForAction = getEntitiesForAction();
      if (entitiesForAction.entities.length === 0) {
        return false;
      }
      actionRegistry.execute(
        'copy',
        entitiesForAction.entities.map(({ entity }) => entity)
      );
      return true;
    },
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
  });

  // ---------------------------------------------------------------------------
  // MOVE TO FOLDER
  // ---------------------------------------------------------------------------
  actionRegistry.register(
    'move_to_project',
    async (entitiesToMove) => {
      const prev = selectedEntity();
      const next = getNextEntity(entitiesToMove);
      try {
        openBulkEditModal({
          view: 'moveToProject',
          entities: entitiesToMove,
          onFinish: () => {
            afterEntityAction(next, true);
          },
          onCancel: () => {
            afterEntityAction(prev);
          },
        });
      } catch (err) {
        console.error('Failed to open bulk move modal', err);
      }
      return { success: true };
    },
    {
      canExecute: (entity) => {
        if (entity.type === 'channel' || entity.type === 'email') return false;
        return true;
      },
    }
  );

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.action.moveToFolder,
    description: () =>
      viewData().multiSelectEntities.length > 1
        ? 'Move items to folder'
        : 'Move item to folder',
    condition: () =>
      isViewingList() &&
      actionRegistry.isActionEnabled(
        'move_to_project',
        plainSelectedEntities()
      ),
    keyDownHandler: () => {
      const entitiesForAction = getEntitiesForAction();
      if (entitiesForAction.entities.length === 0) {
        return false;
      }
      actionRegistry.execute(
        'move_to_project',
        entitiesForAction.entities.map(({ entity }) => entity)
      );
      return true;
    },
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
  });

  const openEntity = (entity: EntityData) => {
    const { type, id } = entity;
    if (type === 'document') {
      const { fileType, subType } = entity;
      splitHandle.replace({
        type: fileTypeToBlockName(subType ?? fileType),
        id,
      });
    } else {
      splitHandle.replace({ type, id });
    }
  };

  const getEntityElAtIndex = (index: number) => {
    const entity = entities()?.at(index);
    if (!entity) return;

    return entityListRef()?.querySelector(`[data-entity-id="${entity.id}"]`);
  };

  const getSelectedEntity = createLazyMemo(() => {
    const index =
      entities()?.findIndex(
        ({ id }) => id === viewData()?.selectedEntity?.id
      ) ?? -1;
    if (index < 0) return;

    const entity = entities()?.at(index);
    if (!entity) return;

    return {
      index,
      entity,
    };
  });

  const getEntitiesForAction = createLazyMemo<{
    entities: Array<{ entity: EntityData; index: number }>;
    beforeEntity: EntityData | null;
    afterEntity: EntityData | null;
  }>(() => {
    const entityList = entities();
    if (!entityList)
      return { entities: [], beforeEntity: null, afterEntity: null };

    const idToIndexMap = new Map(entityList.map(({ id }, i) => [id, i]));
    let selectedEntityIndices: Array<{ entity: EntityData; index: number }> =
      [];

    if (viewData().multiSelectEntities.length > 0) {
      selectedEntityIndices = filterMap(
        viewData().multiSelectEntities,
        (entity) => {
          const index = idToIndexMap.get(entity.id);
          if (index === undefined) {
            return undefined;
          }
          return {
            index,
            entity,
          };
        }
      );
    } else {
      const entity = getSelectedEntity();
      if (entity) selectedEntityIndices = [entity];
    }

    if (selectedEntityIndices.length === 0) {
      return { entities: [], beforeEntity: null, afterEntity: null };
    }

    selectedEntityIndices.sort((a, b) => a.index - b.index);

    const firstIndex = selectedEntityIndices[0].index;
    const lastIndex =
      selectedEntityIndices[selectedEntityIndices.length - 1].index;

    let before = null;
    if (firstIndex === 0) {
      // If first item is at index 0, use the item after the selection as beforeId
      const afterSelectionIndex = lastIndex + 1;
      if (afterSelectionIndex < entityList.length) {
        before = entityList[afterSelectionIndex];
      }
    } else {
      before = entityList[firstIndex - 1];
    }

    // Calculate afterId
    let after = null;
    const afterSelectionIndex = lastIndex + 1;
    if (afterSelectionIndex < entityList.length) {
      after = entityList[afterSelectionIndex];
    }

    return {
      entities: selectedEntityIndices,
      beforeEntity: before,
      afterEntity: after,
    };
  });

  // the full info with indices and neighbors is great but we also need to
  // flatten back to the plain entities a lot - so just memoize.
  const plainSelectedEntities = createLazyMemo(() => {
    return getEntitiesForAction().entities.map(({ entity }) => entity);
  });

  const isEntityLastItem = createLazyMemo(() => {
    const entityList = entities();
    if (!entityList) return false;

    const selectedEntity = getSelectedEntity();
    if (!selectedEntity) return false;

    return selectedEntity.index >= entityList.length - 1;
  });

  const calculateEntityIndex = (
    startIndex: number,
    { axis, mode }: NavigationInput
  ) => {
    let index = startIndex;

    const maxLength = (entities()?.length || 1) - 1;
    if (mode === 'jump') {
      if (axis === 'start') {
        // setIndex(0);
        index = 0;
      } else {
        // setIndex(maxLength);
        index = maxLength;
      }
    } else {
      if (axis === 'start') {
        // setIndex(Math.max(index() - 1, 0));
        index = Math.max(index - 1, 0);
      } else {
        // setIndex(Math.min(index() + 1, maxLength));
        index = Math.min(index + 1, maxLength);
      }
    }

    return index;
  };

  const navigateThroughList = async ({
    axis,
    mode,
  }: NavigationInput): Promise<NavigationResult> => {
    let index = calculateEntityIndex(getSelectedEntity()?.index ?? -1, {
      axis,
      mode,
    });

    setViewDataStore(selectedView(), 'hasUserInteractedEntity', true);

    const entityEl = entityListRef()?.querySelector('[data-entity]');
    const scrollParent = getScrollParent(entityEl);
    const getAdjecentEl = async () => {
      const virtualizer = virtualizerHandle();
      const virtualItems = virtualizer?.getVirtualItems() || [];
      const start = virtualItems[0]?.index;
      const end = virtualItems.at(-1)?.index ?? 0;

      if (index < start) {
        virtualizer?.scrollToIndex(index, { align: 'start' });
      } else if (index > end) {
        virtualizer?.scrollToIndex(index, { align: 'end' });
      }

      if (mode === 'jump') {
        await new Promise<true>((resolve) =>
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(true);
            });
          })
        );
      }

      // Logic fails Entity el dismounts due to EntityList fetching new page
      // *ReSelectEntity effect logic covers this failure
      // should refactor
      const newSelectedEntityEl = getEntityElAtIndex(index);

      const selectedEntity = entities()?.at(index);
      if (selectedEntity) {
        if (
          splitHandle.content().type !== 'component' &&
          splitHandle.content().type !== 'project'
        ) {
          const { type, id } = selectedEntity;
          if (type === 'document') {
            const { fileType, subType } = selectedEntity;
            splitHandle.replace(
              { type: fileTypeToBlockName(subType ?? fileType), id },
              true
            );
          } else {
            splitHandle.replace({ type, id }, true);
          }
        }
        batch(() => {
          setSelectedEntity(selectedEntity);
        });
      }

      if (
        scrollParent instanceof Element &&
        newSelectedEntityEl &&
        mode === 'step'
      ) {
        scrollToKeepGap({
          container: scrollParent,
          target: newSelectedEntityEl.parentElement!,
          align: axis === 'start' ? 'top' : 'bottom',
          gap: ENTITY_HEIGHT,
        });
      }

      return {
        element: newSelectedEntityEl,
        entity: selectedEntity,
      };
    };

    const { element: adjacentEl, entity } = await getAdjecentEl();

    // Logic fails to focus entity element due to EntityList shuffling items after fetching new page
    // *ReSelectEntity effect logic covers this failure
    // should refactor
    if (adjacentEl instanceof HTMLElement) {
      adjacentEl.focus();
      setTimeout(() => adjacentEl.focus());
      return {
        success: true,
        entity,
      };
    }
    return {
      success: false,
      entity,
    };
  };

  unifiedListContext._setNavigateThroughList(navigateThroughList);

  const isEntitySelected = (entityID: string) => {
    return (
      viewData()?.multiSelectEntities.find((e) => e.id === entityID) !==
      undefined
    );
  };

  const toggleEntity = (entity: EntityData) => {
    setViewDataStore(selectedView(), 'multiSelectEntities', (s) => {
      if (isEntitySelected(entity.id)) {
        return s.filter((e) => e.id !== entity.id);
      }
      return s.concat(entity);
    });
  };

  const navigateAndSelectEntity = async (input: NavigationInput) => {
    const { success, entity } = await navigateThroughList(input);

    if (!success || !entity) return;

    toggleEntity(entity);
  };

  const handleNavigationSelection = (input: NavigationInput) => {
    const selectedEntity = getSelectedEntity();
    const currentIndex = selectedEntity?.index ?? -1;
    const nextIndex = calculateEntityIndex(currentIndex, input);

    const nextEntity = entities()?.at(nextIndex);
    if (!nextEntity) return true;

    if (!selectedEntity) {
      navigateAndSelectEntity(input);
      return true;
    }

    // If multiSelectEntities is empty, select current item first without moving
    const multiSelectEntities = viewData()?.multiSelectEntities || [];
    if (multiSelectEntities.length === 0) {
      toggleEntity(selectedEntity.entity);
      return true;
    }

    if (
      !isEntitySelected(selectedEntity.entity.id) &&
      !isEntitySelected(nextEntity.id)
    ) {
      toggleEntity(selectedEntity.entity);
      navigateAndSelectEntity(input);

      return true;
    }

    if (isEntitySelected(nextEntity.id)) {
      toggleEntity(selectedEntity.entity);
      navigateThroughList(input);
      return true;
    }

    navigateAndSelectEntity(input);

    return true;
  };

  registerHotkey({
    scopeId: splitHotkeyScope,
    description: () => {
      return konsoleOpen() ? 'Close command menu' : 'Open command menu';
    },
    hotkey: 'cmd+k',
    condition: () => !konsoleOpen() && isViewingList(),
    keyDownHandler: (e) => {
      e?.preventDefault();
      const multiSelectEntities = viewData().multiSelectEntities;

      const hasSelection = multiSelectEntities.length > 0;

      if (hasSelection) {
        setKonsoleMode('SELECTION_MODIFICATION');
        const selectionIndex = searchCategories.getCategoryIndex('Selection');

        if (selectionIndex === undefined) return false;

        setCommandCategoryIndex(selectionIndex);

        searchCategories.showCategory('Selection');

        setKonsoleContextInformation({
          multiSelectEntities: multiSelectEntities.slice(),
        });

        toggleKonsoleVisibility();
        return true;
      }
      searchCategories.hideCategory('Selection');
      resetCommandCategoryIndex();
      resetKonsoleMode();
      return false;
    },
    displayPriority: 10,
    hide: konsoleOpen,
    runWithInputFocused: true,
  });

  registerEntityHotkey({
    hotkey: ['j', 'arrowdown'],
    scopeId: splitHotkeyScope,
    description: 'Down',
    hotkeyToken: TOKENS.entity.step.end,
    keyDownHandler: () => {
      playSound('down');
      navigateThroughList({ axis: 'end', mode: 'step' });
      return true;
    },
    hide: true,
  });

  registerEntityHotkey({
    hotkey: ['shift+arrowdown', 'shift+j'],
    scopeId: splitHotkeyScope,
    description: 'Select down',
    hotkeyToken: TOKENS.entity.select.end,
    keyDownHandler: () => {
      const navigationInput: NavigationInput = { axis: 'end', mode: 'step' };
      lastMultiNavigationInput = navigationInput;
      return handleNavigationSelection(navigationInput);
    },
    canExecuteKeyDownHandler: () => isViewingList(),
    hide: true,
  });

  registerEntityHotkey({
    hotkey: ['k', 'arrowup'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.step.start,
    description: 'Up',
    keyDownHandler: () => {
      playSound('up');
      navigateThroughList({ axis: 'start', mode: 'step' });
      return true;
    },
    hide: true,
  });

  registerEntityHotkey({
    hotkey: ['shift+arrowup', 'shift+k'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.select.start,
    description: 'Select up',
    keyDownHandler: () => {
      const navigationInput: NavigationInput = { axis: 'start', mode: 'step' };
      lastMultiNavigationInput = navigationInput;
      return handleNavigationSelection(navigationInput);
    },
    canExecuteKeyDownHandler: () => isViewingList(),
    hide: true,
  });
  registerEntityHotkey({
    hotkey: ['home'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.jump.home,
    description: 'Top',
    keyDownHandler: () => {
      navigateThroughList({ axis: 'start', mode: 'jump' });
      return true;
    },
    hide: true,
  });
  registerEntityHotkey({
    hotkey: ['shift+g', 'end'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.jump.end,
    description: 'Go to bottom of list',
    keyDownHandler: () => {
      navigateThroughList({ axis: 'end', mode: 'jump' });
      return true;
    },
    hide: true,
  });

  const navigateThroughViews = ({
    axis,
  }: {
    axis: 'start' | 'end'; // movement direction
  }) => {
    let index = viewIds().indexOf(selectedView());
    const maxLength = viewIds().length;
    index = (index + (axis === 'start' ? -1 : 1) + maxLength) % maxLength;
    const newViewId = viewIds()[index];
    setSelectedView(newViewId);
  };

  const splitIsUnifiedList = createMemo(
    () => splitHandle.content().id === 'unified-list'
  );

  for (let i = 0; i < viewIds().length && i < 9; i++) {
    const viewId = viewIds()[i];
    const viewData = viewsData[viewId];
    registerHotkey({
      hotkeyToken:
        TOKENS.soup.tabs[i.toString() as keyof typeof TOKENS.soup.tabs],
      hotkey: [(i + 1).toString() as ValidHotkey],
      scopeId: splitHotkeyScope,
      description: viewData.view,
      condition: splitIsUnifiedList,
      keyDownHandler: () => {
        setSelectedView(viewData.id);
        return true;
      },
      // displayPriority: 0,
      hide: true,
    });
  }
  1;

  registerHotkey({
    hotkey: 'tab',
    scopeId: splitHotkeyScope,
    description: 'Next View',
    condition: splitIsUnifiedList,
    keyDownHandler: () => {
      navigateThroughViews({ axis: 'end' });
      return true;
    },
    // displayPriority: 0,
    hide: true,
  });
  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: splitHotkeyScope,
    description: 'Previous View',
    condition: splitIsUnifiedList,
    keyDownHandler: () => {
      navigateThroughViews({ axis: 'start' });
      return true;
    },
    // displayPriority: 0,
    hide: true,
  });

  registerEntityHotkey({
    hotkey: ['enter'],
    hotkeyToken: TOKENS.entity.open,
    scopeId: splitHotkeyScope,
    description: 'Open',
    hide: true,
    keyDownHandler: () => {
      const entity = getSelectedEntity()?.entity;
      if (!entity) return false;

      openEntity(entity);
      return true;
    },
    canExecuteKeyDownHandler: ({ keyboardEvent }) => {
      if (!isViewingList()) return false;

      if (keyboardEvent) {
        const target = getActualTarget(keyboardEvent);

        if (entityListRef()?.contains(target)) {
          return true;
        }

        if (isInteractiveElement(target)) {
          return false;
        }
      }
      return true;
    },
    displayPriority: 4,
  });
  registerEntityHotkey({
    hotkey: ['cmd+enter'],
    scopeId: splitHotkeyScope,
    description: 'Focus Preview',
    keyDownHandler: () => {
      const [preview] = previewState;

      const entity = getSelectedEntity()?.entity;
      if (!entity) return false;

      if (preview()) {
        // focus inside preview block
        const blockEl = document.getElementById(`block-${entity.id}`);
        if (blockEl) {
          // TODO: use state instead to determine when preview block can recieve focus
          blockEl.setAttribute('data-allow-focus-in-preview', '');

          blockEl.focus();
          const getEnterCommand = () => {
            const currentActiveScope = activeScope();
            if (!currentActiveScope) return undefined;
            let activeScopeNode = hotkeyScopeTree.get(currentActiveScope);
            if (!activeScopeNode) return undefined;
            if (activeScopeNode?.type !== 'dom') return;
            const dom = activeScopeNode.element;
            const closestBlockScope = dom.closest(`[id="block-${entity.id}"]`);
            if (
              !closestBlockScope ||
              !(closestBlockScope instanceof HTMLElement)
            )
              return;
            const scopeId = closestBlockScope.dataset.hotkeyScope;
            if (!scopeId) return undefined;
            const splitNode = hotkeyScopeTree.get(scopeId);
            if (!splitNode) return undefined;
            return splitNode.hotkeyCommands.get('enter');
          };
          const command = getEnterCommand();
          if (command) {
            runCommand(command);
          }
        }
        return true;
      }

      openEntity(entity);
      return true;
    },
    canExecuteKeyDownHandler: () => isViewingList(),
    displayPriority: 4,
  });
  registerEntityHotkey({
    hotkey: ['x'],
    scopeId: splitHotkeyScope,
    description: 'Toggle select item',
    keyDownHandler: () => {
      const entity = getSelectedEntity();
      if (!entity) return false;
      toggleEntity(entity.entity);
      return true;
    },
    canExecuteKeyDownHandler: () => isViewingList(),
    displayPriority: 10,
  });

  const clearMultiCondition: () => boolean = () =>
    isViewingList() && viewData().multiSelectEntities.length > 0;
  const closeSpotlightCondition = () => splitHandle.isSpotLight();
  const goHomeCondition = () => !splitIsUnifiedList();
  const closeSplitCondition = () => splitIsUnifiedList() && getSplitCount() > 1;
  const escapeDescription = () => {
    if (clearMultiCondition()) {
      return 'Clear multi selection';
    }
    if (closeSpotlightCondition()) {
      return 'Close spotlight';
    }
    if (closeSplitCondition()) {
      return 'Close split';
    }
    if (goHomeCondition()) {
      return 'Go home';
    }
    return '';
  };
  registerHotkey({
    hotkey: ['escape'],
    scopeId: splitHotkeyScope,
    description: escapeDescription,
    condition: () =>
      clearMultiCondition() ||
      closeSpotlightCondition() ||
      closeSplitCondition() ||
      goHomeCondition(),
    keyDownHandler: () => {
      if (clearMultiCondition()) {
        const length = viewData().multiSelectEntities.length;
        setViewDataStore(selectedView(), 'multiSelectEntities', []);
        return length > 1;
      }
      if (closeSpotlightCondition()) {
        splitHandle.toggleSpotlight();
        return true;
      }
      if (closeSplitCondition()) {
        splitHandle.close();
        return true;
      }
      if (goHomeCondition()) {
        splitHandle.replace({ type: 'component', id: 'unified-list' });
        return true;
      }
      return false;
    },
  });
}

const useAllViews = ({
  selectedViewSignal,
}: {
  selectedViewSignal: Signal<string>;
}): ReturnType<typeof createStore<ViewDataMap>> => {
  const [selectedView, setSelectedView] = selectedViewSignal;
  const initialState: ViewDataMap = {};
  for (const [view, viewProps] of Object.entries(VIEWCONFIG_DEFAULTS)) {
    initialState[view] = createViewData(view as DefaultView, viewProps);
  }

  const [viewsData, setViewsData] = createStore(initialState);

  // add all default views
  const savedViews = useQuery(() => ({
    queryKey: ['savedViews'],
    queryFn: async () => {
      const resp = await storageServiceClient.views.getSavedViews();

      if (isErr(resp)) {
        throw Error(resp[0][0].message);
      }
      return resp[1];
    },
  }));

  // signal version
  createEffect(
    on(
      () => savedViews.data,
      (data) => {
        if (!data) return;

        const savedViewConfigs = data.views.map((view) => {
          const config = view.config as ViewConfigBase;

          return createViewData(view.name as DefaultView, {
            id: view.id,
            view: view.name as DefaultView,
            display: { ...VIEWCONFIG_BASE.display, ...config.display },
            filters: { ...VIEWCONFIG_BASE.filters, ...config.filters },
            sort: {
              ...VIEWCONFIG_BASE.sort,
              ...config.sort,
            },
          });
        });
        const savedViewsData: ViewDataMap = Object.fromEntries(
          savedViewConfigs.map((view) => [view.id, view])
        );

        // Filter viewsData to exclude items that are not in savedViewConfigs, except for default views
        const savedViewIds = new Set(savedViewConfigs.map((view) => view.id));
        const filteredViewsData = Object.fromEntries(
          Object.entries(viewsData).filter(
            ([viewId, viewData]) =>
              savedViewIds.has(viewId) ||
              DEFAULT_VIEW_IDS_SET.has(viewId as DefaultView) ||
              viewData.viewType !== undefined
          )
        );

        // Deduplicate items with same id, prioritizing savedViewConfigs over filteredDefaultViews
        const uniqueViews: ViewDataMap = {
          ...filteredViewsData,
          ...savedViewsData,
        };
        if (!uniqueViews[selectedView()]) {
          setSelectedView(DEFAULT_VIEW_ID);
        }

        setViewsData(reconcile(uniqueViews));
      }
    )
  );

  return [viewsData, setViewsData] as const;
};

let globalKeyboardEvent: KeyboardEvent | undefined;

type ExecuteKeyDownHandlerCallback = (props: {
  keyboardEvent?: KeyboardEvent;
}) => boolean;

/**
 *
 * Registers entity hotkeys to global scope and split panel scope. When global hotkey is fired, runs hotkey command from active split panel scope.
 *
 */
function registerEntityHotkey(
  opts: Omit<Parameters<typeof registerHotkey>[0], 'condition'> & {
    canExecuteKeyDownHandler?: ExecuteKeyDownHandlerCallback;
    globalCommandScope?: string;
  }
): {
  registerHotkeyReturn: {
    commandScopeId: string;
  };
  globalRegisterHotkeyReturn: {
    commandScopeId: string;
  };
} {
  onCleanup(() => {
    globalKeyboardEvent = undefined;
  });

  // scoped hotkey
  const registerHotkeyReturn = registerHotkey({
    ...opts,
    keyDownHandler: (e) => {
      const canExecuteKeyDownHandler = () => {
        if (!opts.canExecuteKeyDownHandler) return true;
        return opts.canExecuteKeyDownHandler({
          keyboardEvent: e ?? globalKeyboardEvent,
        });
      };

      if (canExecuteKeyDownHandler()) {
        return opts.keyDownHandler(e);
      }

      return false;
    },
    condition: undefined,
  });
  // global hotkey to run active split scope command
  const globalRegisterHotkeyReturn = registerHotkey({
    ...opts,
    scopeId: opts.globalCommandScope ? opts.globalCommandScope : 'global',
    hotkeyToken: undefined,
    tags: undefined,
    condition: undefined,
    keyDownHandler: (event) => {
      globalKeyboardEvent = event;
      queueMicrotask(() => {
        globalKeyboardEvent = undefined;
      });

      if (event) {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            `
            [role="dialog"],
            [role="alertdialog"],
            [data-modal="true"],
            .z-modal,
            .z-modal-overlay
            `
          )
        ) {
          return false;
        }
      }

      const currentActiveSplitId = globalSplitManager()?.activeSplitId();

      const getCommand = () => {
        const splitScope = document.querySelector(
          `[data-split-id="${currentActiveSplitId}"]`
        );
        if (!splitScope || !(splitScope instanceof HTMLElement)) return;
        const scopeId = splitScope.dataset.hotkeyScope;
        if (!scopeId) return undefined;
        const splitNode = hotkeyScopeTree.get(scopeId);
        if (!splitNode) return undefined;
        return splitNode.hotkeyCommands.get(
          // @ts-expect-error
          opts.hotkey[0]
        );
      };
      const command = getCommand();
      if (!command) return false;

      runCommand(command);
      return false;
    },
  });

  return {
    registerHotkeyReturn,
    globalRegisterHotkeyReturn,
  } as any;
}
