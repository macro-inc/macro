import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useIsAuthenticated } from '@core/auth';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { Button } from '@core/component/FormControls/Button';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { ENABLE_FOLDER_UPLOAD } from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import type { BlockOrchestrator } from '@core/orchestrator';
import {
  CONDITIONAL_VIEWS,
  DEFAULT_VIEWS,
  type DefaultView,
  VIEWS,
  type View,
  type ViewId,
} from '@core/types/view';
import { handleFileFolderDrop } from '@core/util/upload';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tabs } from '@kobalte/core/tabs';
import type { EntityData } from '@macro-entity';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { createEffectOnEntityTypeNotification } from '@notifications/notificationHelpers';
import { storageServiceClient } from '@service-storage/client';
import { Navigate } from '@solidjs/router';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import {
  type Component,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  type ParentComponent,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { EntityModal } from './EntityModal/EntityModal';
import { HelpDrawer } from './HelpDrawer';
import { SplitHeaderLeft } from './split-layout/components/SplitHeader';
import { SplitTabs } from './split-layout/components/SplitTabs';
import { SplitToolbarRight } from './split-layout/components/SplitToolbar';
import type { SplitPanelContextType } from './split-layout/context';
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
  viewId: ViewId;
}> = (props) => {
  return (
    <Tabs.Content class="flex flex-col size-full" value={props.viewId}>
      {/* If Kobalte TabContent recieves Suspense as direct child, Suspense owner doesn't cleanup and causes memory leak */}
      {/* Make sure Suspense isn't root child by by wrapping children with DOM node */}
      <div class="contents">{props.children}</div>
    </Tabs.Content>
  );
};

const DefaultViewTab: Component<{
  viewId: ViewId;
}> = (props) => {
  return (
    <ViewTab viewId={props.viewId}>
      <Suspense>
        <UnifiedListView />
      </Suspense>
    </ViewTab>
  );
};

const ConditionalViewTab: ParentComponent<{
  view: Exclude<View, DefaultView>;
}> = (props) => {
  return (
    <Show when={VIEWS.includes(props.view)}>
      <ViewTab viewId={props.view}>{props.children}</ViewTab>
    </Show>
  );
};

const ViewWithSearch: Component<{
  viewId: ViewId;
}> = (props) => {
  return (
    <Switch>
      <Match when={props.viewId === 'emails'}>
        <ConditionalViewTab view="emails">
          <Suspense>
            <EmailView />
          </Suspense>
        </ConditionalViewTab>
      </Match>
      <Match when={props.viewId === 'all'}>
        <ConditionalViewTab view="all">
          <Suspense>
            <AllView />
          </Suspense>
        </ConditionalViewTab>
      </Match>
      <Match when={true}>
        <DefaultViewTab viewId={props.viewId} />
      </Match>
    </Switch>
  );
};

const PreviewPanelContent: Component<{
  selectedEntity: EntityData;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
}> = (props) => {
  const blockInstance = () =>
    props.orchestrator.createBlockInstance(
      props.selectedEntity.type === 'document'
        ? fileTypeToBlockName(props.selectedEntity.fileType)
        : props.selectedEntity.type,
      props.selectedEntity.id
    );
  const [interactedWithMouseDown, setInteractedWithMouseDown] =
    createSignal(false);

  createRenderEffect((prevId: string) => {
    const id = props.selectedEntity.id;
    if (id !== prevId) {
      setInteractedWithMouseDown(false);
    }
    return id;
  }, props.selectedEntity.id);

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
          ...props.splitPanelContext,
          layoutRefs: {
            ...props.splitPanelContext.layoutRefs,
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
};

const PreviewPanel: Component<{
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
}> = (props) => {
  return (
    <div class="flex flex-row size-full w-[70%] shrink-0">
      <Show
        when={props.selectedEntity?.type !== 'project' && props.selectedEntity}
      >
        {(selectedEntity) => (
          <PreviewPanelContent
            selectedEntity={selectedEntity()}
            orchestrator={props.orchestrator}
            splitPanelContext={props.splitPanelContext}
          />
        )}
      </Show>
    </div>
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
  // Use preview state from SplitPanelContext (created in SplitLayout for unified-list)
  const previewState = () => splitPanelContext.previewState;
  const preview = () => previewState()?.[0]?.() ?? false;
  const setPreview = (value: boolean | ((prev: boolean) => boolean)) => {
    const state = previewState();
    if (state) {
      const [, setState] = state;
      if (typeof value === 'function') {
        setState((prev) => value(prev));
      } else {
        setState(value);
      }
    }
  };
  const selectedEntity = () => view().selectedEntity;

  const orchestrator = useGlobalBlockOrchestrator();

  const entityQueryClient = useEntityQueryClient();

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

  registerHotkey({
    hotkey: ['p'],
    scopeId: splitHotkeyScope,
    description: 'Toggle Preview',
    hotkeyToken: TOKENS.unifiedList.togglePreview,
    keyDownHandler: () => {
      setPreview((prev) => !prev);
      return true;
    },
    hide: true,
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
    const isDefaultView = () =>
      VIEWCONFIG_DEFAULTS_NAMES.includes(props.value as View);
    return (
      <Show when={!isDefaultView()}>
        <ContextMenu>
          <ContextMenu.Trigger class="absolute inset-0" />
          <ContextMenu.Portal>
            <ContextMenuContent mobileFullScreen>
              <MenuItem
                text="Rename"
                disabled={isDefaultView()}
                onClick={() => {
                  setTimeout(() => {
                    setIsModalOpen(true);
                  });
                  // Don't mutate here, let the modal handle it
                }}
              />
              <MenuItem
                text="Delete"
                disabled={isDefaultView()}
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
            class="@container/soup flex flex-col gap-1 size-full overflow-x-clip"
            classList={{
              'border-r border-edge-muted': preview(),
              'pt-2 pb-0': showHelpDrawer().has(selectedView()),
            }}
            value={selectedView()}
            onChange={setSelectedView}
          >
            <SplitHeaderLeft>
              <SplitTabs
                list={Object.values(viewsData).map((view, index) => ({
                  value: view.id,
                  label: view.view,
                  index: index
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
              {(viewId) => <ViewWithSearch viewId={viewId} />}
            </For>
          </Tabs>
        </SplitPanelContext.Provider>
        <Show when={preview()}>
          <PreviewPanel
            selectedEntity={selectedEntity()}
            orchestrator={orchestrator}
            splitPanelContext={splitPanelContext}
          />
        </Show>
      </div>
      <Show when={showHelpDrawer().has(selectedView())}>
        <HelpDrawer view={view().view} />
      </Show>
    </div>
  );
}

function AllView() {
  return <UnifiedListView />;
}

function EmailView() {
  const {
    emailViewSignal: [emailView, setEmailView],
    viewsDataStore,
    selectedView,
  } = useSplitPanelOrThrow().unifiedListContext;
  const viewData = createMemo(() => viewsDataStore[selectedView()]);

  return (
    <>
      <UnifiedListView />
      <SplitToolbarRight>
        <div class="flex flex-row items-center pr-2">
          <SegmentedControl
            disabled={!!viewData().searchText}
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
      const isDefaultView = VIEWCONFIG_DEFAULTS_NAMES.includes(
        viewData.id as View
      );
      if ('config' in viewData) {
        // if data id is in defaults, exclude default, set up args to create new view
        if (isDefaultView) {
          // don't exclude default view on editing default view config
          // await storageServiceClient.views.excludeDefaultView({
          //   defaultViewId: viewData.id!,
          // });
          viewData.id = undefined;
          viewData.name = `My ${viewData.name}`;
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
        if (isDefaultView) {
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
