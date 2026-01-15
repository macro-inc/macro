import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { PreviewPanel } from '@app/component/PreviewPanel';
import { SplitPanelContext } from '@app/component/split-layout/context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { UnifiedListView } from '@app/component/UnifiedListView';
import { PROJECT_VIEWCONFIG_BASE } from '@app/component/ViewConfig';
import { playSound } from '@app/util/sound';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { ENABLE_PROJECT_VIEW_PREVIEW } from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  handleFileFolderDrop,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { refetchResources } from '@service-storage/util/refetchResources';
import { toast } from 'core/component/Toast/Toast';
import {
  type Component,
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import { projectBlockDataSignal } from '../signal/projectBlockData';
import { TopBar } from './TopBar';

// HACK: prevent lint error on custom directive
false && fileFolderDrop;
false && fileSelector;

const Block: Component = () => {
  const [isDragging, setIsDragging] = createSignal(false);
  const projectId = useBlockId();
  const isSpecialProject = getIsSpecialProject(projectId);
  const name = () => projectBlockDataSignal()?.projectMetadata.name;
  const entityQueryClient = useEntityQueryClient();

  const handleFileUpload = async (files: UploadInput[]) => {
    if (files.length === 0) return;

    // Don't allow uploads to root or trash
    if (isSpecialProject) {
      toast.failure('Cannot upload files to this location');
      return;
    }

    try {
      const results = await uploadFiles(files, 'dss', {
        projectId,
      });

      const uploads = results.filter((result) => !result.failed);

      // show documents that were immediately uploaded
      const successfulUploads = uploads.filter((result) => !result.pending);
      if (successfulUploads.length > 0) {
        entityQueryClient.invalidateQueries({
          queryKey: queryKeys.all.dss,
        });
        refetchResources();
      }

      // wait for pending folder uploads to finish upload before refetching resources
      const pendingFolderUploads = uploads
        .filter((result) => result.pending)
        .filter((result) => result.type === 'folder')
        .map((result) => result.projectId);
      if (pendingFolderUploads.length > 0) {
        await Promise.all(pendingFolderUploads);
        entityQueryClient.invalidateQueries({
          queryKey: queryKeys.all.dss,
        });
        refetchResources();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.failure('Upload failed. Please try again.');
    }
  };

  const orchestrator = useGlobalBlockOrchestrator();
  const splitPanelContext = useSplitPanelOrThrow();
  const {
    selectedView,
    setSelectedView,
    setViewDataStore,
    isRenderedFromPreview,
    viewsDataStore: viewsData,
  } = splitPanelContext.soupContext;
  const [preview, setPreview] = splitPanelContext.previewState;
  const view = createMemo(() => viewsData[selectedView()]);
  const selectedEntity = () => view().selectedEntity;

  if (!isRenderedFromPreview) {
    registerHotkey({
      hotkey: ['space'],
      scopeId: splitPanelContext.splitHotkeyScope,
      description: 'Toggle Preview',
      hotkeyToken: TOKENS.unifiedList.togglePreview,
      keyDownHandler: () => {
        playSound('open');
        setPreview((prev) => !prev);
        return true;
      },
      hide: true,
    });
  }

  createRenderEffect(() => {
    const previousView = untrack(selectedView);

    setSelectedView(projectId);

    setViewDataStore(projectId, {
      ...PROJECT_VIEWCONFIG_BASE,
      id: projectId,
      view: name() ?? 'folder',
      multiSelectEntities: [],
      filters: {
        ...PROJECT_VIEWCONFIG_BASE.filters,
        projectFilter: projectId,
      },
    });

    onCleanup(() => {
      setSelectedView(previousView);
      setViewDataStore(projectId, undefined);
    });
  });

  return (
    <DocumentBlockContainer>
      <div
        class="w-full h-full bg-panel flex flex-col relative"
        use:fileFolderDrop={{
          onDragStart: () => setIsDragging(true),
          onDragEnd: () => setIsDragging(false),
          onDrop: (fileEntries, folderEntries) => {
            handleFileFolderDrop(fileEntries, folderEntries, handleFileUpload);
          },
          disabled: isSpecialProject,
        }}
      >
        <Show when={isDragging() && !isSpecialProject}>
          <FileDropOverlay>Upload to this folder</FileDropOverlay>
        </Show>
        <TopBar />
        <Show when={ENABLE_PROJECT_VIEW_PREVIEW} fallback={<UnifiedListView />}>
          <div class="flex size-full">
            <SplitPanelContext.Provider
              value={{
                ...splitPanelContext,
                halfSplitState: () =>
                  preview() ? { side: 'left', percentage: 30 } : undefined,
              }}
            >
              <UnifiedListView hideToolbar={isRenderedFromPreview} />
            </SplitPanelContext.Provider>
            <Show when={preview()}>
              <PreviewPanel
                selectedEntity={selectedEntity()}
                orchestrator={orchestrator}
                splitPanelContext={splitPanelContext}
              />
            </Show>
          </div>
        </Show>
      </div>
    </DocumentBlockContainer>
  );
};

export default Block;
