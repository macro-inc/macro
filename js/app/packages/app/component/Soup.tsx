import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { playSound } from '@app/util/sound';
import { useIsAuthenticated } from '@core/auth';
import type { BlockAliasContext } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { Button } from '@core/component/FormControls/Button';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { ContextMenuContent, MenuItem } from '@core/component/Menu';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import type { RegisterHotkeyReturn } from '@core/hotkey/types';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { BlockOrchestrator } from '@core/orchestrator';
import {
  DEFAULT_VIEWS,
  type DefaultView,
  type ViewId,
  type ViewLabel,
} from '@core/types/view';
import { handleFileFolderDrop } from '@core/util/upload';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Tabs } from '@kobalte/core/tabs';
import type { EntityData } from '@macro-entity';
import {
  isTaskEntity,
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { createEffectOnEntityTypeNotification } from '@notifications';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import { storageServiceClient } from '@service-storage/client';
import { Navigate } from '@solidjs/router';
import { useMutation, useQueryClient } from '@tanstack/solid-query';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import {
  type Component,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  type ParentComponent,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { EntityModal } from './EntityModal/EntityModal';
import { HelpDrawer } from './HelpDrawer';
import { SuspenseContextComp } from './SuspenseContext';
import { SplitHeaderLeft } from './split-layout/components/SplitHeader';
import { SplitTabs } from './split-layout/components/SplitTabs';
import { SplitToolbarRight } from './split-layout/components/SplitToolbar';
import type { SplitPanelContextType } from './split-layout/context';
import { SplitPanelContext } from './split-layout/context';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';
import { UnifiedListView } from './UnifiedListView';
import {
  VIEWCONFIG_BASE,
  VIEWCONFIG_DEFAULTS_IDS,
  type ViewConfigBase,
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

let runSuspenseWarningLog = false;
const SuspenseUnifiedListFallback = () => {
  const runWarningLog = () => {
    if (!runSuspenseWarningLog) {
      setTimeout(() => {
        runSuspenseWarningLog = true;
      });
      return;
    }

    console.warn('UnifiedList Suspsense Triggered');
  };

  runWarningLog();

  return null;
};

const ViewWithSearch: Component<{
  viewId: ViewId;
}> = (props) => {
  return (
    <ViewTab viewId={props.viewId}>
      <Switch>
        <Match
          when={props.viewId === 'email' && DEFAULT_VIEWS.includes('email')}
        >
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <EmailView />
          </SuspenseContextComp>
        </Match>
        <Match when={props.viewId === 'all' && DEFAULT_VIEWS.includes('all')}>
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <AllView />
          </SuspenseContextComp>
        </Match>
        <Match when={true}>
          <SuspenseContextComp fallback={<SuspenseUnifiedListFallback />}>
            <UnifiedListView />
          </SuspenseContextComp>
        </Match>
      </Switch>
    </ViewTab>
  );
};

const PreviewPanelContent: Component<{
  selectedEntity: EntityData;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
}> = (props) => {
  const blockInstance = () => {
    const aliasContext = isTaskEntity(props.selectedEntity)
      ? ({
          alias: 'task',
          baseType: 'md',
        } as BlockAliasContext)
      : undefined;
    return props.orchestrator.createBlockInstance(
      props.selectedEntity.type === 'document'
        ? fileTypeToResolvedBlockName(props.selectedEntity.fileType)
        : props.selectedEntity.type,
      props.selectedEntity.id,
      { aliasContext }
    );
  };
  const [interactedWith, setInteractedWith] = createSignal(false);

  createRenderEffect((prevId: string) => {
    const id = props.selectedEntity.id;
    if (id !== prevId) {
      setInteractedWith(false);
    }
    return id;
  }, props.selectedEntity.id);

  return (
    <div
      class="size-full"
      onFocusIn={(event) => {
        if (interactedWith()) return;
        const relatedTarget = event.relatedTarget as HTMLElement;
        const currentTarget = event.currentTarget as HTMLElement;

        // TODO: use state instead to determine when preview block can recieve focus
        if (event.target.hasAttribute('data-allow-focus-in-preview')) {
          setInteractedWith(true);
          return;
        }

        if (!currentTarget.contains(relatedTarget)) {
          relatedTarget.focus();
        }
      }}
      onPointerDown={() => {
        setInteractedWith(true);
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
    <div class="flex flex-row size-full sm:w-[70%] max-sm:h-[50%] max-sm:border-t border-edge-muted shrink-0 sm:shadow-inner">
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
    handle,
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
  const previewState = () => splitPanelContext.previewState;
  const [preview, setPreview] = previewState();
  const selectedEntity = () => view().selectedEntity;

  // Sync selected view to split metadata
  createEffect(() => {
    handle.updateMeta?.({ viewId: selectedView() });
  });

  const orchestrator = useGlobalBlockOrchestrator();

  const entityQueryClient = useEntityQueryClient();

  const hotkeyDisposers: RegisterHotkeyReturn[] = [];

  hotkeyDisposers.push(
    registerHotkey({
      hotkey: ['shift+/'],
      scopeId: splitHotkeyScope,
      description: () =>
        `${showHelpDrawer().has(selectedView() as DefaultView) ? 'Hide' : 'Show'} help drawer`,
      hotkeyToken: TOKENS.split.showHelpDrawer,
      keyDownHandler: () => {
        if (showHelpDrawer().has(selectedView() as DefaultView)) {
          setShowHelpDrawer(new Set<DefaultView>());
        } else {
          setShowHelpDrawer(new Set(DEFAULT_VIEWS));
        }
        return true;
      },
    })
  );

  hotkeyDisposers.push(
    registerHotkey({
      hotkey: ['p'],
      scopeId: splitHotkeyScope,
      description: 'Toggle Preview',
      hotkeyToken: TOKENS.unifiedList.togglePreview,
      keyDownHandler: () => {
        playSound('open');
        setPreview((prev) => !prev);
        return true;
      },
      // displayPriority: 10,
    })
  );

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
    (notification) => {
      entityQueryClient.invalidateQueries({
        queryKey: queryKeys.all.channel,
      });
      invalidateEntityNotifications(notification.entity_id);
    }
  );

  createEffectOnEntityTypeNotification(notificationSource, 'email', () => {
    entityQueryClient.invalidateQueries({
      // HACK: this needs to be improved, since we use a single query, per entity invalidations
      // become a little more complicated.
      queryKey: queryKeys.all.entity,
    });
  });

  const saveViewMutation = useUpsertSavedViewMutation();

  let tabsRef: HTMLDivElement | undefined;

  onCleanup(() => {
    setEntityListRef(undefined);
    hotkeyDisposers.forEach((disposer) => disposer.dispose());
  });

  const TabContextMenu = (props: { value: ViewId; label: string }) => {
    const [isModalOpen, setIsModalOpen] = createSignal(false);
    const isDefaultView = () =>
      VIEWCONFIG_DEFAULTS_IDS.includes(props.value as DefaultView);
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

      <div class="relative flex-grow min-h-0 flex max-sm:flex-col flex-row size-full">
        <SplitPanelContext.Provider
          value={{
            ...splitPanelContext,
            halfSplitState: () =>
              preview() ? { side: 'left', percentage: 30 } : undefined,
          }}
        >
          <Tabs
            ref={tabsRef}
            class="@container/soup [container-type:inline-size] flex flex-col gap-1 size-full overflow-x-clip"
            classList={{
              'border-r border-edge-muted': preview(),
            }}
            value={selectedView()}
            onChange={setSelectedView}
          >
            <SplitHeaderLeft>
              <SplitTabs
                list={Object.values(viewsData).map((view, index) => ({
                  value: view.id,
                  label: view.view,
                  index: index,
                }))}
                active={selectedView}
                contextMenu={({ value, label }) => (
                  <TabContextMenu value={value} label={label} />
                )}
                newButton={
                  <div class="flex items-center px-2 h-full">
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
      <Show
        when={
          showHelpDrawer().has(selectedView() as DefaultView) &&
          !isNativeMobilePlatform()
        }
      >
        <HelpDrawer viewId={view().id} />
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
            id?: ViewId;
            name: ViewLabel;
          }
        | {
            id: ViewId;
          }
    ) => {
      const isDefaultView = VIEWCONFIG_DEFAULTS_IDS.includes(
        viewData.id as DefaultView
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
