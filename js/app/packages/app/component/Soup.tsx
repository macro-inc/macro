import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useIsAuthenticated } from '@core/auth';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { Button } from '@core/component/FormControls/Button';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { IconButton } from '@core/component/IconButton';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  ENABLE_FOLDER_UPLOAD,
  ENABLE_SEARCH_VIEW,
} from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import {
  CONDITIONAL_VIEWS,
  DEFAULT_VIEWS,
  type DefaultView,
  VIEWS,
  type View,
  type ViewId,
} from '@core/types/view';
import { handleFileFolderDrop } from '@core/util/upload';
import SearchIcon from '@icon/regular/magnifying-glass.svg?component-solid';
import LoadingSpinner from '@icon/regular/spinner.svg?component-solid';
import XIcon from '@icon/regular/x.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tabs } from '@kobalte/core/tabs';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { createEffectOnEntityTypeNotification } from '@notifications/notificationHelpers';
import { storageServiceClient } from '@service-storage/client';
import { debounce } from '@solid-primitives/scheduled';
import { Navigate } from '@solidjs/router';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  batch,
  type Component,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  type ParentComponent,
  type Setter,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { EntityModal } from './EntityModal/EntityModal';
import { HelpDrawer } from './HelpDrawer';
import { SplitHeaderLeft } from './split-layout/components/SplitHeader';
import { SplitTabs } from './split-layout/components/SplitTabs';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from './split-layout/components/SplitToolbar';
import { SplitPanelContext } from './split-layout/context';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import { UnifiedListView } from './UnifiedListView';
import {
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_NAMES,
  type ViewConfigBase,
  type ViewConfigDefaultsName,
} from './ViewConfig';

false && fileFolderDrop;

const ViewTab: ParentComponent<{
  view: ViewId;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}> = (props) => {
  return (
    <Tabs.Content class="flex flex-col size-full" value={props.view}>
      {/* If Kobalte TabContent recieves Suspense as direct child, Suspense owner doesn't cleanup and causes memory leak */}
      {/* Make sure Suspense isn't root child by by wrapping children with DOM node */}
      <div class="contents">{props.children}</div>
      <SearchBar
        viewId={props.view}
        isLoading={props.isLoading}
        setIsLoading={props.setIsLoading}
      />
    </Tabs.Content>
  );
};

const DefaultViewTab: Component<{
  view: ViewId;
  searchText: string;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}> = (props) => {
  return (
    <ViewTab
      view={props.view}
      isLoading={props.isLoading}
      setIsLoading={props.setIsLoading}
    >
      <Suspense>
        <UnifiedListView
          viewId={props.view}
          searchText={props.searchText}
          onLoadingChange={props.setIsLoading}
        />
      </Suspense>
    </ViewTab>
  );
};

const ConditionalViewTab: ParentComponent<{
  view: Exclude<View, DefaultView>;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}> = (props) => {
  return (
    <Show when={VIEWS.includes(props.view)}>
      <ViewTab
        view={props.view}
        isLoading={props.isLoading}
        setIsLoading={props.setIsLoading}
      >
        {props.children}
      </ViewTab>
    </Show>
  );
};

const ViewWithState: Component<{ view: ViewId }> = (props) => {
  const { getSelectedViewStore: viewData } =
    useSplitPanelOrThrow().unifiedListContext;
  const searchText = createMemo<string>(() => viewData().searchText ?? '');
  const [isLoading, setIsLoading] = createSignal(false);

  return (
    <Switch>
      <Match when={props.view === 'emails'}>
        <ConditionalViewTab
          view="emails"
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        >
          <Suspense>
            <EmailView searchText={searchText()} setIsLoading={setIsLoading} />
          </Suspense>
        </ConditionalViewTab>
      </Match>
      <Match when={props.view === 'all'}>
        <ConditionalViewTab
          view="all"
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        >
          <Suspense>
            <AllView searchText={searchText()} setIsLoading={setIsLoading} />
          </Suspense>
        </ConditionalViewTab>
      </Match>
      <Match when={true}>
        <DefaultViewTab
          view={props.view}
          searchText={searchText()}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      </Match>
    </Switch>
  );
};

export function Soup() {
  const authenticated = useIsAuthenticated();
  if (!authenticated()) return <Navigate href="/" />;

  const splitPanelContext = useSplitPanelOrThrow();
  const {
    splitHotkeyScope,
    unifiedListContext: {
      viewsDataStore: viewsData,
      selectedView,
      setSelectedView,
      entityListRefSignal: [, setEntityListRef],
      showHelpDrawer,
      setShowHelpDrawer,
    },
  } = splitPanelContext;
  const view = createMemo(() => viewsData[selectedView()]);
  const preview = () => view().display.preview;
  const selectedEntity = () => view().selectedEntity;

  const orchestrator = useGlobalBlockOrchestrator();

  const entityQueryClient = useEntityQueryClient();

  onMount(() => {
    if (!ENABLE_SEARCH_VIEW) return;

    const { dispose } = registerHotkey({
      hotkey: ['/'],
      scopeId: splitHotkeyScope,
      description: 'Search in current view',
      hotkeyToken: TOKENS.soup.openSearch,
      keyDownHandler: () => {
        setTimeout(() => {
          const searchInput = document.getElementById(
            `search-input-${selectedView()}`
          ) as HTMLInputElement;
          searchInput?.focus();
        }, 0);
        return true;
      },
      displayPriority: 5,
    });
    onCleanup(() => {
      dispose();
    });
  });

  registerHotkey({
    hotkey: ['shift+/'],
    scopeId: splitHotkeyScope,
    description: () =>
      `${showHelpDrawer().has(selectedView()) ? 'Hide' : 'Show'} help drawer`,
    hotkeyToken: TOKENS.split.showHelpDrawer,
    keyDownHandler: () => {
      if (showHelpDrawer().has(selectedView())) {
        setShowHelpDrawer(new Set<string>());
      } else {
        setShowHelpDrawer(new Set([...DEFAULT_VIEWS, ...CONDITIONAL_VIEWS]));
      }
      return true;
    },
  });

  const [isDragging, setIsDragging] = createSignal(false);
  const [isValidDrag, setIsValidDrag] = createSignal(true);

  const droppableId = 'soup-drop-zone';
  const droppable = createDroppable(droppableId);

  const dragDropContext = useDragDropContext();
  if (dragDropContext) {
    dragDropContext[1].onDragEnd((event) => {
      if (!event.droppable || event.droppable.id !== droppableId) return;

      // TODO: moveToFolder action
    });
  }

  const handleFileUpload = useHandleFileUpload();

  const notificationSource = useGlobalNotificationSource();
  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notifications) => {
      entityQueryClient.invalidateQueries({
        queryKey: queryKeys.all.channel,
      });
      const eventItemIds = new Set(
        notifications.map(({ eventItemId }) => eventItemId)
      );
      eventItemIds.forEach((eventItemId) => {
        entityQueryClient.invalidateQueries({
          queryKey: queryKeys.notification({ eventItemId }),
        });
      });
    }
  );
  createEffectOnEntityTypeNotification(notificationSource, 'email', () =>
    entityQueryClient.invalidateQueries({
      queryKey: queryKeys.all.email,
    })
  );

  const saveViewMutation = useUpsertSavedViewMutation();

  let tabsRef: HTMLDivElement | undefined;

  onCleanup(() => setEntityListRef(undefined));

  const TabContextMenu = (props: { value: ViewId; label: string }) => {
    const [isModalOpen, setIsModalOpen] = createSignal(false);
    return (
      <Show when={!VIEWCONFIG_DEFAULTS_NAMES.includes(props.value as any)}>
        <ContextMenu>
          <ContextMenu.Trigger class="absolute inset-0" />
          <ContextMenu.Portal>
            <ContextMenuContent mobileFullScreen>
              <MenuItem
                text="Rename"
                disabled={VIEWCONFIG_DEFAULTS_NAMES.includes(
                  props.value as any
                )}
                onClick={() => {
                  setTimeout(() => {
                    setIsModalOpen(true);
                  });
                  // Don't mutate here, let the modal handle it
                }}
              />
              <MenuItem
                text="Delete"
                disabled={VIEWCONFIG_DEFAULTS_NAMES.includes(
                  props.value as any
                )}
                onClick={() => {
                  saveViewMutation.mutate({
                    id: props.value,
                  });
                }}
              />
            </ContextMenuContent>
          </ContextMenu.Portal>
        </ContextMenu>
        <EntityModal
          isOpen={isModalOpen}
          setIsOpen={setIsModalOpen}
          view={() => 'rename'}
          viewId={props.value}
        />
      </Show>
    );
  };

  return (
    <div
      class="relative flex flex-col bg-panel size-full"
      use:droppable
      use:fileFolderDrop={{
        onDrop: (fileEntries, folderEntries) => {
          handleFileFolderDrop(fileEntries, folderEntries, handleFileUpload);
        },
        onDragStart: () => {
          setIsValidDrag(true);
          setIsDragging(true);
        },
        onDragEnd: () => setIsDragging(false),
        folder: ENABLE_FOLDER_UPLOAD,
      }}
    >
      <Show when={isDragging() || droppable.isActiveDroppable}>
        <FileDropOverlay valid={isValidDrag()}>
          <Show when={!isValidDrag()}>
            <div class="font-mono text-failure">[!] Invalid file type</div>
          </Show>
          <div class="font-mono">
            Drop any file here to add it to your workspace
          </div>
        </FileDropOverlay>
      </Show>

      <div class="relative flex-grow min-h-0 flex flex-row size-full">
        <SplitPanelContext.Provider
          value={{
            ...splitPanelContext,
            halfSplitState: () =>
              preview() ? { side: 'left', percentage: 30 } : undefined,
          }}
        >
          <Tabs
            ref={tabsRef}
            class="@container/soup flex flex-col gap-1 size-full p-2 overflow-x-clip"
            classList={{
              'border-r border-edge-muted': preview(),
              'pt-2 pb-0': showHelpDrawer().has(selectedView()),
            }}
            value={selectedView()}
            onChange={setSelectedView}
          >
            <SplitHeaderLeft>
              <SplitTabs
                list={Object.values(viewsData).map((view) => ({
                  value: view.id,
                  label: view.view,
                }))}
                active={selectedView}
                contextMenu={({ value, label }) => (
                  <TabContextMenu value={value} label={label} />
                )}
                newButton={
                  <div class="flex items-center px-2 border-t border-t-edge-muted border-b border-b-edge-muted h-full">
                    <Button
                      size="Base"
                      classList={{
                        '!border-transparent hover:!border-ink/50 px-1 !text-ink !bg-panel font-medium': true,
                      }}
                      onClick={() => {
                        saveViewMutation.mutate({
                          name: 'New View',
                          config: VIEWCONFIG_BASE,
                        });
                      }}
                    >
                      +
                    </Button>
                  </div>
                }
              />
            </SplitHeaderLeft>
            <For each={Object.keys(viewsData)}>
              {(viewId) => <ViewWithState view={viewId} />}
            </For>
          </Tabs>
        </SplitPanelContext.Provider>
        <Show when={preview()}>
          <div class="flex flex-row size-full w-[70%] shrink-0">
            {/* must access property, id, on selectedEntity in order to make it reactive   */}
            <Show when={selectedEntity()?.id && selectedEntity()}>
              {(_) => {
                const entity = selectedEntity()!;
                const blockInstance = () =>
                  orchestrator.createBlockInstance(
                    entity.type === 'document'
                      ? fileTypeToBlockName(entity.fileType)
                      : entity.type,
                    entity.id
                  );
                const [interactedWithMouseDown, setInteractedWithMouseDown] =
                  createSignal(false);

                // Reset interaction state whenever the previewed entity changes
                createRenderEffect(
                  (prevId: string | undefined) => {
                    const id = entity.id as string | undefined;
                    if (id !== prevId) {
                      setInteractedWithMouseDown(false);
                    }
                    return id;
                  },
                  entity.id as string | undefined
                );

                return (
                  <div
                    class="size-full"
                    onFocusIn={(event) => {
                      if (interactedWithMouseDown()) return;
                      const relatedTarget = event.relatedTarget as HTMLElement;
                      const currentTarget = event.currentTarget as HTMLElement;

                      if (!currentTarget.contains(relatedTarget)) {
                        relatedTarget.focus();
                      }
                    }}
                    onPointerDown={() => {
                      setInteractedWithMouseDown(true);
                    }}
                  >
                    <SplitPanelContext.Provider
                      value={{
                        ...splitPanelContext,
                        layoutRefs: {
                          ...splitPanelContext.layoutRefs,
                          headerLeft: undefined,
                          headerRight: undefined,
                        },
                        halfSplitState: () => ({
                          side: 'right',
                          percentage: 30,
                        }),
                      }}
                    >
                      <Dynamic component={blockInstance().element} />
                    </SplitPanelContext.Provider>
                  </div>
                );
              }}
            </Show>
          </div>
        </Show>
      </div>
      <Show when={showHelpDrawer().has(selectedView())}>
        <HelpDrawer view={view().view} />
      </Show>
    </div>
  );
}

function SearchBar(props: {
  viewId: ViewId;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
}) {
  const {
    getSelectedViewStore: viewData,
    setSelectedViewStore,
    entitiesSignal: [entities],
    virtualizerHandleSignal: [virtualizerHandle],
    entityListRefSignal: [entityListRef],
  } = useSplitPanelOrThrow().unifiedListContext;

  let inputRef: HTMLInputElement | undefined;

  const searchText = createMemo<string>(() => viewData().searchText ?? '');
  const setSearchText = (text: string) => {
    setSelectedViewStore('searchText', text);
  };

  const debouncedSetSearch = debounce(setSearchText, 200);

  const isElementInViewport = (element: Element): Promise<boolean> => {
    return new Promise((resolve) => {
      const observer = new IntersectionObserver(
        (entries) => {
          resolve(entries[0].isIntersecting);
          observer.disconnect();
        },
        { threshold: 0.1 }
      );
      observer.observe(element);
    });
  };

  const focusFirstEntity = async () => {
    const highlightedId = viewData()?.highlightedId;
    const id = highlightedId;

    if (id) {
      const highlightedEntityEl = entityListRef()?.querySelector(
        `[data-entity-id="${id}"]`
      );

      if (
        highlightedEntityEl instanceof HTMLElement &&
        (await isElementInViewport(highlightedEntityEl))
      ) {
        highlightedEntityEl.focus();
        const entity = entities()?.find(({ id: entityId }) => entityId === id);
        if (entity) {
          setSelectedViewStore('selectedEntity', entity);
          return;
        }
      }
    }

    // Fallback to first entity
    const firstEntity = entityListRef()?.querySelector('[data-entity]');
    if (firstEntity instanceof HTMLElement) firstEntity.focus();
  };

  const [waitForLoadingEnd, setWaitForLoadingEnd] = createSignal(false);

  // When search text changes, mark that we're waiting for loading to end
  createRenderEffect((prevText: string) => {
    const text = searchText().trim();
    if (text !== prevText) {
      batch(() => {
        setSelectedViewStore('selectedEntity', undefined);
        setSelectedViewStore('highlightedId', undefined);
      });
      virtualizerHandle()?.scrollToIndex(0);
      setWaitForLoadingEnd(true);
    }
    return text;
  }, searchText());

  // When we're no longer loading but still waiting, reset the list
  createRenderEffect((prevLoading: boolean) => {
    const loading = props.isLoading();

    if (prevLoading && !loading && waitForLoadingEnd()) {
      // Loading just ended and we were waiting for it
      setWaitForLoadingEnd(false);
      virtualizerHandle()?.scrollToIndex(0);
    }

    return loading;
  }, props.isLoading());

  return (
    <SplitToolbarLeft>
      <div class="flex mx-2 h-full items-center gap-1">
        <Show
          when={!props.isLoading() || !searchText()}
          fallback={
            <LoadingSpinner class="w-4 h-4 text-ink-muted animate-spin shrink-0" />
          }
        >
          <SearchIcon class="w-4 h-4 text-ink-muted shrink-0" />
        </Show>
        <input
          ref={inputRef}
          id={`search-input-${props.viewId}`}
          placeholder="Search"
          value={searchText()}
          onInput={(e) => {
            debouncedSetSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Escape' ||
              e.key === 'ArrowDown' ||
              e.key === 'Enter'
            ) {
              e.preventDefault();
              e.currentTarget.blur();
              focusFirstEntity();
            }
          }}
          class="p-1 pr-0 border-0 outline-none! focus:outline-none ring-0! focus:ring-0 flex-1 text-ink text-sm truncate"
        />
        <Show when={searchText()}>
          <IconButton
            theme="clear"
            size="sm"
            tooltip={{ label: 'Clear search' }}
            icon={XIcon}
            onClick={() => {
              setSearchText('');
              setTimeout(() => {
                inputRef?.focus();
              }, 0);
            }}
          />
        </Show>
      </div>
    </SplitToolbarLeft>
  );
}

function AllView(props: { searchText: string; setIsLoading: Setter<boolean> }) {
  return (
    <UnifiedListView
      viewId="all"
      searchText={props.searchText}
      onLoadingChange={props.setIsLoading}
    />
  );
}

function EmailView(props: {
  searchText: string;
  setIsLoading: Setter<boolean>;
}) {
  const {
    emailViewSignal: [emailView, setEmailView],
  } = useSplitPanelOrThrow().unifiedListContext;

  return (
    <>
      <UnifiedListView
        viewId="emails"
        searchText={props.searchText}
        onLoadingChange={props.setIsLoading}
      />
      <SplitToolbarRight>
        <div class="flex flex-row items-center pr-2">
          <SegmentedControl
            disabled={props.searchText.length > 0}
            size="SM"
            label="View"
            list={['inbox', 'sent', 'drafts']}
            value={emailView()}
            onChange={setEmailView}
          />
        </div>
      </SplitToolbarRight>
    </>
  );
}

export const useUpsertSavedViewMutation = () => {
  const queryClient = useQueryClient();
  return useMutation(() => ({
    mutationFn: async (
      viewData:
        | {
            config: ViewConfigBase;
            id?: ViewConfigDefaultsName | string;
            name: string;
          }
        | {
            id: ViewConfigDefaultsName | string;
          }
    ) => {
      if ('config' in viewData) {
        // if data id is in defaults, exclude default, set up args to create new view
        if (VIEWCONFIG_DEFAULTS_NAMES.includes(viewData.id as any)) {
          // don't exclude default view on editing default view config
          // await storageServiceClient.views.excludeDefaultView({
          //   defaultViewId: viewData.id!,
          // });
          viewData.id = undefined;
          viewData.name = 'My ' + viewData.name;
        }
        // create new view
        if (!viewData.id) {
          return await storageServiceClient.views.createSavedView({
            name: viewData.name,
            config: viewData.config,
          });
        } // patch existing view
        else {
          return await storageServiceClient.views.patchView({
            saved_view_id: viewData.id,
            name: viewData.name,
            config: viewData.config,
          });
        }
      } else {
        // delete or exclude view
        if (VIEWCONFIG_DEFAULTS_NAMES.includes(viewData.id as any)) {
          // for now don't exclude default view
          // return await storageServiceClient.views.excludeDefaultView({
          //   defaultViewId: viewData.id,
          // });
        } else {
          return await storageServiceClient.views.deleteView({
            savedViewId: viewData.id,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedViews'] });
    },
  }));
};
