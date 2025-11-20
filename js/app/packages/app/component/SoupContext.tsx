import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { HotkeyTags } from '@core/hotkey/constants';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import {
  CONDITIONAL_VIEWS,
  DEFAULT_VIEWS,
  type View,
  type ViewId,
} from '@core/types/view';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import { getScrollParent } from '@core/util/scrollParent';
import { waitForFrames } from '@core/util/sleep';
import type { EntityData } from '@macro-entity';
import { useTutorialCompleted } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import { createLazyMemo } from '@solid-primitives/memo';
import { useQuery } from '@tanstack/solid-query';
import {
  registerHotkey,
  runCommand,
  useHotkeyDOMScope,
} from 'core/hotkey/hotkeys';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  type Setter,
  type Signal,
} from 'solid-js';
import {
  createStore,
  reconcile,
  type SetStoreFunction,
  type Store,
} from 'solid-js/store';
import type { VirtualizerHandle } from 'virtua/solid';
import { useUserId } from '../../macro-entity/src/queries/auth';
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

export type UnifiedListContext = {
  viewsDataStore: Store<ViewDataMap>;
  setViewDataStore: SetStoreFunction<Partial<ViewDataMap>>;
  selectedView: Accessor<ViewId>;
  setSelectedView: Setter<ViewId>;
  virtualizerHandleSignal: Signal<VirtualizerHandle | undefined>;
  entityListRefSignal: Signal<HTMLDivElement | undefined>;
  entitiesSignal: Signal<EntityData[] | undefined>;
  emailViewSignal: Signal<'inbox' | 'sent' | 'drafts' | 'all'>;
  showHelpDrawer: Accessor<Set<string>>;
  setShowHelpDrawer: Setter<Set<string>>;
  actionRegistry: EntityActionRegistry;
};

const DEFAULT_VIEW_ID: View = 'all';

const DEFAULT_VIEW_IDS_SET = new Set(VIEWCONFIG_DEFAULTS_IDS);

export function createSoupContext(): UnifiedListContext {
  const [selectedView, setSelectedView] = createSignal<ViewId>(DEFAULT_VIEW_ID);
  const [viewsDataStore, setViewDataStore_] = useAllViews({
    selectedViewSignal: [selectedView, setSelectedView],
  });
  const virtualizerHandleSignal = createSignal<VirtualizerHandle>();
  const entityListRefSignal = createSignal<HTMLDivElement>();
  const entitiesSignal = createSignal<EntityData[]>();
  const emailViewSignal = createSignal<'inbox' | 'sent' | 'drafts' | 'all'>(
    'inbox'
  );
  const tutorialCompleted = useTutorialCompleted();
  const [showHelpDrawer, setShowHelpDrawer] = createSignal<Set<string>>(
    !tutorialCompleted()
      ? new Set([...DEFAULT_VIEWS, ...CONDITIONAL_VIEWS])
      : new Set()
  );
  const setViewDataStore: SetStoreFunction<ViewDataMap> = (...args: any[]) => {
    // need to create new reference, causes bug where first entity persits highlighting
    if (
      args.length === 3 &&
      args[1] === 'selectedEntity' &&
      typeof args[2] !== 'function'
    ) {
      args[2] = { ...args[2] };
    }
    // @ts-ignore narrowing set store function is annoying due to function overloading
    setViewDataStore_(...args);
  };

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
  };
}

function createViewData(
  view: View,
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
      limit: viewProps?.display?.limit,
    },
    sort: {
      sortBy: viewProps?.sort?.sortBy ?? VIEWCONFIG_BASE.sort.sortBy,
      sortOrder: viewProps?.sort?.sortOrder ?? VIEWCONFIG_BASE.sort.sortOrder,
    },
    highlightedId: undefined,
    selectedEntity: undefined,
    scrollOffset: undefined,
    initialConfig: undefined,
    selectedEntities: [],
    hasUserInteractedEntity: false,
    searchText: viewProps?.searchText,
  };
}

type NavigationInput = {
  axis: 'start' | 'end'; // movement direction
  mode: 'step' | 'jump'; // how far: one step or to the end
  highlight?: boolean;
};

type NavigationResult = {
  success: boolean;
  entity: EntityData | undefined;
};

export function createNavigationEntityListShortcut({
  splitName,
  splitHandle,
  splitHotkeyScope,
  unifiedListContext,
  previewState,
}: {
  splitName: Accessor<string>;
  splitHandle: SplitHandle;
  splitHotkeyScope: string;
  unifiedListContext: UnifiedListContext;
  previewState: Signal<boolean>;
}) {
  const {
    viewsDataStore: viewsData,
    setViewDataStore,
    entityListRefSignal: [entityListRef],
    virtualizerHandleSignal: [virtualizerHandle],
    selectedView,
    setSelectedView,
    // selectedEntitySignal: [selectedEntity, setSelectedEntity],
    entitiesSignal: [entities],
    actionRegistry,
  } = unifiedListContext;
  const viewData = createMemo(() => viewsData[selectedView()]);
  const viewIds = createMemo<ViewId[]>(() => Object.keys(viewsData));

  const selectedEntity = () => viewData().selectedEntity;
  const userId = useUserId();

  const notificationSource = useGlobalNotificationSource();

  const isViewingList = createMemo(() => {
    return splitHandle.content().id === 'unified-list';
  });
  createEffect(() => console.log('IS VIEWING LIST', isViewingList()));

  actionRegistry.register('mark_as_done', async (entities) => {
    const handler =
      VIEWCONFIG_DEFAULTS[selectedView() as View]?.hotkeyOptions?.e;
    if (handler) {
      if (isEntityLastItem()) {
        navigateThroughList({ axis: 'start', mode: 'step' });
      } else {
        navigateThroughList({ axis: 'end', mode: 'step' });
      }

      for (const entity of entities) {
        handler(entity, {
          soupContext: unifiedListContext,
          notificationSource,
        });
      }

      setViewDataStore(selectedView(), 'selectedEntities', []);
    }

    return { success: true };
  });

  actionRegistry.register(
    'delete',
    async (entitiesToDelete) => {
      const entityList = entities();
      if (!entityList) return { success: false };

      const idToIndexMap = new Map(entityList.map(({ id }, i) => [id, i]));
      let maxIndex = 0;
      for (const entity of entitiesToDelete) {
        const ndx = idToIndexMap.get(entity.id);
        if (ndx && ndx > maxIndex) {
          maxIndex = ndx;
        }
      }
      const next =
        maxIndex < entityList.length - 1 ? entityList[maxIndex + 1] : null;

      try {
        openBulkEditModal({
          view: 'delete',
          entities: entitiesToDelete,
          onFinish: () => {
            setViewDataStore(selectedView(), 'selectedEntities', []);
            if (next !== null) {
              setViewDataStore(selectedView(), 'selectedEntity', next);
              setViewDataStore(selectedView(), 'highlightedId', next.id);
              const nextIndex = entities()?.findIndex(
                ({ id }) => id === next.id
              );
              if (nextIndex !== undefined && nextIndex > -1) {
                virtualizerHandle()?.scrollToIndex(nextIndex, {
                  align: 'nearest',
                });
                waitForFrames(2).then(() => {
                  const elem = getEntityElAtIndex(nextIndex);
                  if (elem instanceof HTMLElement) {
                    elem.focus();
                    return;
                    // cooked state (no focus returned)
                  }
                });
              } else {
                const firstIndex = virtualizerHandle()?.findStartIndex();
                if (!firstIndex) return;
                const elem = getEntityElAtIndex(firstIndex);
                if (elem instanceof HTMLElement) elem.focus();
                // cooked state (no focus returned)
              }
            }
          },
        });
      } catch (err) {
        console.error('Failed to open bulk delete modal', err);
      }
      return { success: true };
    },
    {
      testEnabled: (entity) => {
        // can't delete these bad boys yet.
        if (entity.type === 'channel' || entity.type === 'email') return false;
        // only delete what you own.
        return entity.ownerId === userId();
      },
      // TODO (seamus): fix the handler from the modal so that we can delete
      // some of the items. Then switch this to some.
      enabledMode: 'every',
    }
  );

  const openEntity = (entity: EntityData) => {
    const { type, id } = entity;
    if (type === 'document') {
      const { fileType } = entity;
      splitHandle.replace({ type: fileTypeToBlockName(fileType), id });
    } else {
      splitHandle.replace({ type, id });
    }
  };

  const activeHighlightedId = () => {
    return viewData()?.highlightedId;
  };

  const [jumpedToEnd, setJumpedToEnd] = createSignal(false);

  const getSelectedEntityEl = () => {
    const entity = selectedEntity();
    if (!entity) return;

    return entityListRef()?.querySelector(`[data-entity-id="${entity.id}"]`);
  };

  const getEntityElAtIndex = (index: number) => {
    const entity = entities()?.at(index);
    if (!entity) return;

    return entityListRef()?.querySelector(`[data-entity-id="${entity.id}"]`);
  };

  const getHighlightedEntity = createLazyMemo(() => {
    const index =
      entities()?.findIndex(({ id }) => id === activeHighlightedId()) ?? -1;
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

    if (viewData().selectedEntities.length > 0) {
      selectedEntityIndices = filterMap(
        viewData().selectedEntities,
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
      const entity = getHighlightedEntity();
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

    const highlightedEntity = getHighlightedEntity();
    if (!highlightedEntity) return false;

    return highlightedEntity.index >= entityList.length - 1;
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
    let index = calculateEntityIndex(getHighlightedEntity()?.index ?? -1, {
      axis,
      mode,
    });
    setJumpedToEnd(false);

    setViewDataStore(selectedView(), 'hasUserInteractedEntity', true);

    const entityEl = entityListRef()?.querySelector('[data-entity]');
    const scrollParent = getScrollParent(entityEl);

    const getAdjecentEl = async () => {
      virtualizerHandle()?.scrollToIndex(index, {
        // align: mode === 'jump' && axis === 'end' ? 'end' : undefined,
        // align: align(),
        // align: index() < virtuaRef()!.findStartIndex() ? 'start' : 'end',
        align: 'nearest',
        // offset: 50,
      });

      if (mode === 'jump') {
        setJumpedToEnd(true);

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
        if (splitHandle.content().type !== 'component') {
          const { type, id } = selectedEntity;
          if (type === 'document') {
            const { fileType } = selectedEntity;
            splitHandle.replace(
              { type: fileTypeToBlockName(fileType), id },
              true
            );
          } else {
            splitHandle.replace({ type, id }, true);
          }
        }
        batch(() => {
          setViewDataStore(selectedView(), 'highlightedId', selectedEntity.id);
          setViewDataStore(selectedView(), 'selectedEntity', selectedEntity);
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

  const scrollToEntityFromId = async () => {
    const index = getHighlightedEntity()?.index;
    if (!index) return;

    virtualizerHandle()?.scrollToIndex(index, {
      align: 'nearest',
    });

    await new Promise<true>((resolve) =>
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve(true);
        });
      })
    );
  };

  const addScrollEventToList = () => {
    const listScrollEl = entityListRef();

    const onListScroll = () => {
      if (listScrollEl) {
        setViewDataStore(
          selectedView(),
          'scrollOffset',
          listScrollEl.scrollTop
        );
      }
    };

    listScrollEl?.addEventListener('scroll', onListScroll);
  };

  const isEntitySelected = (entityID: string) => {
    return (
      viewData()?.selectedEntities.find((e) => e.id === entityID) !== undefined
    );
  };

  const toggleEntity = (entity: EntityData) => {
    setViewDataStore(selectedView(), 'selectedEntities', (s) => {
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
    const highlightedEntity = getHighlightedEntity();
    const currentIndex = highlightedEntity?.index ?? -1;
    const nextIndex = calculateEntityIndex(currentIndex, input);

    const nextEntity = entities()?.at(nextIndex);
    if (!nextEntity) return true;

    if (!highlightedEntity) {
      navigateAndSelectEntity(input);
      return true;
    }

    // If selectedEntities is empty, select current item first without moving
    const selectedEntities = viewData()?.selectedEntities || [];
    if (selectedEntities.length === 0) {
      toggleEntity(highlightedEntity.entity);
      return true;
    }

    if (
      !isEntitySelected(highlightedEntity.entity.id) &&
      !isEntitySelected(nextEntity.id)
    ) {
      toggleEntity(highlightedEntity.entity);
      navigateAndSelectEntity(input);

      return true;
    }

    if (isEntitySelected(nextEntity.id)) {
      toggleEntity(highlightedEntity.entity);
      navigateThroughList(input);
      return true;
    }

    navigateAndSelectEntity(input);

    return true;
  };

  let virtuaMount = true;
  createEffect(
    on(virtualizerHandle, (virtuaRef) => {
      if (!virtuaRef) return;

      // reselect entity on mount
      if (!jumpedToEnd() && activeHighlightedId()) {
        if (!virtuaMount) return;

        virtuaMount = false;
        scrollToEntityFromId();
        const scrollOffset = viewData()?.scrollOffset;
        // restore scroll overrides scroll to id
        const offset = scrollOffset;
        if (offset) virtuaRef.scrollTo(offset);

        // only add scroll event after virtua is done scrolling to scrollTop/index
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            addScrollEventToList();
          });
        });
      } else {
        addScrollEventToList();
      }
    })
  );

  createEffect(
    on([entities, virtualizerHandle] as const, ([curr, virtuaRef], _prev) => {
      const prev = _prev?.[0];
      if (!curr || !prev || !virtuaRef) return;

      const newIndex = getHighlightedEntity()?.index;

      // ReSelectEntity
      // ScrollTo and Select correct Entity after EntityList fetches new page, since list shuffles items
      if (newIndex && curr[newIndex]?.id !== prev[newIndex]?.id) {
        scrollToEntityFromId().then(() => {
          const entityEl = getSelectedEntityEl();

          if (jumpedToEnd()) {
            // only refocus when navigation hotkey is activated before

            if (entityEl instanceof HTMLElement) {
              entityEl.focus();
              setTimeout(() => {
                entityEl.focus();
                setJumpedToEnd(false);
              });
              return true;
            }
          }
        });
      }
    })
  );

  registerHotkey({
    scopeId: splitHotkeyScope,
    description: 'Root Modify selection',
    hotkey: 'cmd+k',
    condition: () => !konsoleOpen() && isViewingList(),
    keyDownHandler: (e) => {
      e?.preventDefault();
      const selectedEntities = viewData().selectedEntities;

      const hasSelection = selectedEntities.length > 0;

      if (hasSelection) {
        setKonsoleMode('SELECTION_MODIFICATION');
        const selectionIndex = searchCategories.getCateoryIndex('Selection');

        if (selectionIndex === undefined) return false;

        setCommandCategoryIndex(selectionIndex);

        searchCategories.showCategory('Selection');

        setKonsoleContextInformation({
          selectedEntities: selectedEntities.slice(),
        });

        toggleKonsoleVisibility();
        return true;
      }
      searchCategories.hideCategory('Selection');
      resetCommandCategoryIndex();
      resetKonsoleMode();
      return false;
    },
  });

  registerHotkey({
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
  registerHotkey({
    hotkey: ['shift+arrowdown', 'shift+j'],
    scopeId: splitHotkeyScope,
    description: 'Select down',
    hotkeyToken: TOKENS.entity.step.end,
    keyDownHandler: () => {
      const navigationInput: NavigationInput = { axis: 'end', mode: 'step' };
      return handleNavigationSelection(navigationInput);
    },
    hide: true,
  });
  registerHotkey({
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

  registerHotkey({
    hotkey: ['shift+arrowup', 'shift+k'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.step.start,
    description: 'Select up',
    keyDownHandler: () => {
      const navigationInput: NavigationInput = { axis: 'start', mode: 'step' };
      return handleNavigationSelection(navigationInput);
    },
    hide: true,
  });
  registerHotkey({
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
  registerHotkey({
    hotkey: ['shift+g', 'end'],
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.entity.jump.end,
    description: 'Bottom',
    keyDownHandler: () => {
      navigateThroughList({ axis: 'end', mode: 'jump' });
      return true;
    },
    hide: true,
  });
  const topGScope = registerHotkey({
    hotkey: ['g'],
    scopeId: splitHotkeyScope,
    description: 'Top',
    keyDownHandler: () => true,
    activateCommandScope: true,
    hide: true,
  });
  registerHotkey({
    hotkey: ['g'],
    scopeId: topGScope.commandScopeId,
    description: 'Top',
    keyDownHandler: () => {
      navigateThroughList({ axis: 'start', mode: 'jump' });
      return true;
    },
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

  const splitIsUnifiedList = createMemo(() => splitName() === 'unified-list');

  createEffect(() => {
    for (let i = 0; i < viewIds().length && i < 9; i++) {
      const viewId = viewIds()[i];
      const viewData = viewsData[viewId];
      registerHotkey({
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
  });

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

  const [attachEntityHotkeys, entityHotkeyScope] = useHotkeyDOMScope('entity');
  registerHotkey({
    hotkey: ['enter'],
    scopeId: entityHotkeyScope,
    description: 'Open',
    keyDownHandler: () => {
      const [preview] = previewState;
      if (!preview()) return false;

      const entity = getHighlightedEntity()?.entity;
      if (!entity) return false;

      openEntity(entity);
      return true;
    },
    displayPriority: 4,
  });
  registerHotkey({
    hotkey: ['cmd+enter'],
    scopeId: entityHotkeyScope,
    description: 'Focus Preview',
    keyDownHandler: () => {
      const [preview] = previewState;

      const entity = getHighlightedEntity()?.entity;
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
          // runCommandByToken(TOKENS.block.focus);
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
    displayPriority: 4,
  });
  registerHotkey({
    hotkey: ['e'],
    scopeId: entityHotkeyScope,
    description: 'Mark done',
    condition: () =>
      isViewingList() &&
      !actionRegistry.isActionEnabled('mark_as_done', plainSelectedEntities()),
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
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  });
  registerHotkey({
    hotkey: ['x'],
    scopeId: entityHotkeyScope,
    description: 'Toggle select item',
    condition: isViewingList,
    keyDownHandler: () => {
      const entity = getHighlightedEntity();
      if (!entity) return false;
      toggleEntity(entity.entity);
      return true;
    },
    displayPriority: 10,
  });
  registerHotkey({
    hotkey: ['escape'],
    scopeId: splitHotkeyScope,
    description: 'Clear multi selection',
    condition: () => isViewingList() && viewData().selectedEntities.length > 0,
    keyDownHandler: () => {
      const length = viewData().selectedEntities.length;
      setViewDataStore(selectedView(), 'selectedEntities', []);
      return length > 1;
    },
  });
  registerHotkey({
    hotkey: ['delete', 'backspace'],
    scopeId: splitHotkeyScope,
    description: () =>
      viewData().selectedEntities.length > 1 ? 'Delete items' : 'Delete item',
    condition: () =>
      isViewingList() &&
      !actionRegistry.isActionEnabled('delete', plainSelectedEntities()),
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
    tags: [HotkeyTags.SelectionModification],
    displayPriority: 10,
  });

  createEffect(() => {
    const ref = entityListRef();
    if (!ref) return;

    attachEntityHotkeys(ref);
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
    initialState[view] = createViewData(view as View, viewProps);
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

          return createViewData(view.name as View, {
            id: view.id,
            view: view.name as View,
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
              DEFAULT_VIEW_IDS_SET.has(viewId as View) ||
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

type AlignMode = 'top' | 'bottom';

/**
 * Conditionally scrolls the container to align the target element
 * near either the container's top or bottom based on the align parameter.
 *
 * @param container - The scrollable container
 * @param target - The element to bring into view
 * @param threshold - Distance from the viewport edge within which to trigger scroll
 * @param gap - Desired distance from the aligned edge after scrolling
 * @param align - "top" or "bottom" (default: "bottom")
 */
export function scrollToKeepGap({
  container,
  target,
  threshold,
  gap,
  align = 'bottom',
}: {
  container: Element;
  target: Element;
  threshold?: number; // px distance from edge to trigger scroll
  gap?: number; // px distance from edge after scrolling
  align?: AlignMode; // "top" | "bottom"
}) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Relative positions (in container scroll coordinates)
  const targetTop = targetRect.top - containerRect.top + container.scrollTop;
  const targetBottom =
    targetRect.bottom - containerRect.top + container.scrollTop;

  gap = targetRect.height ?? 50;
  threshold = targetRect.height ?? 50;

  if (align === 'bottom') {
    const containerBottom = container.scrollTop + container.clientHeight;
    const distanceToBottom = containerBottom - targetBottom;

    if (distanceToBottom <= threshold) {
      const newScrollTop = targetBottom - container.clientHeight + gap;
      container.scrollTo({ top: newScrollTop, behavior: 'auto' });
    }
  } else {
    // align = "top"
    const distanceToTop = targetTop - container.scrollTop;

    if (distanceToTop <= threshold) {
      const newScrollTop = targetTop - gap;
      container.scrollTo({ top: newScrollTop, behavior: 'auto' });
    }
  }
}
