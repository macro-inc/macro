import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { UnifiedListView } from '@app/component/UnifiedListView';
import { PROJECT_VIEWCONFIG_BASE } from '@app/component/ViewConfig';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import {
  handleFileFolderDrop,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import Files from '@phosphor-icons/core/duotone/files-duotone.svg?component-solid';
import { refetchResources } from '@service-storage/util/refetchResources';
import { toast } from 'core/component/Toast/Toast';
import {
  type Component,
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

  const splitContext = useSplitPanelOrThrow();
  const { selectedView, setSelectedView, setViewDataStore } =
    splitContext.unifiedListContext;

  createRenderEffect(() => {
    const previousView = untrack(selectedView);

    setSelectedView(projectId);

    setViewDataStore(projectId, {
      ...PROJECT_VIEWCONFIG_BASE,
      id: projectId,
      view: name() ?? 'folder',
      selectedEntities: [],
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
          <div class="hidden sm:flex flex-col absolute top-0 left-0 w-full h-full backdrop-blur-sm bg-accent/10 items-center justify-center space-y-3 z-3">
            <Files class="w-[80px] h-[80px] text-ink" />
            <h3 class="text-2xl font-semibold text-ink">
              Upload to {name() ?? 'folder'}
            </h3>
            <p class="text-sm text-ink-muted">
              Drop files or folders here to upload
            </p>
          </div>
        </Show>
        <TopBar />
        <UnifiedListView />
      </div>
    </DocumentBlockContainer>
  );
};

export default Block;
