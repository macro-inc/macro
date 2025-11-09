import { UnifiedListView } from '@app/component/UnifiedListView';
import {
  blockExpandedProjectsStore,
  blockPreSearchExpandedProjectsStore,
} from '@block-project/signal/expandedProjects';
import {
  blockActiveFilters,
  blockFileSearchQuery,
  blockFileSort,
  blockOwnershipFilters,
  blockShowProjectsFirst,
  blockShowTrash,
} from '@block-project/signal/filter';
import { blockFilteredFileTreeStore } from '@block-project/signal/filteredFileTree';
import {
  persitedViewFilter,
  savePersistedViewFilter,
} from '@block-project/signal/persistedViewFilter';
import { blockSelectedItems } from '@block-project/signal/selectedItems';
import { blockViewSize, blockViewType } from '@block-project/signal/view';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { buildFileTreeWithAncestors } from '@core/component/FileList/buildFileTree';
import { matchesActiveFilters } from '@core/component/FileList/Filter';
import { setExpandedProject } from '@core/component/FileList/fileTree';
import { ENABLE_FOLDER_UPLOAD } from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { isErr } from '@core/util/maybeResult';
import {
  handleFileFolderDrop,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import Files from '@phosphor-icons/core/duotone/files-duotone.svg?component-solid';
import { useUserId } from '@service-gql/client';
import { storageServiceClient } from '@service-storage/client';
import { useDeletedTree } from '@service-storage/deleted';
import type { Project } from '@service-storage/generated/schemas/project';
import { useHistoryTree } from '@service-storage/history';
import { refetchResources } from '@service-storage/util/refetchResources';
import { useSearchParams } from '@solidjs/router';
import { toast } from 'core/component/Toast/Toast';
import fuzzy from 'fuzzy';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Show,
  untrack,
} from 'solid-js';
import { projectSignal } from '../signal/project';
import { projectBlockDataSignal } from '../signal/projectBlockData';
import { TopBar } from './TopBar';

// HACK: prevent lint error on custom directive
false && fileFolderDrop;
false && fileSelector;

const Block: Component = () => {
  const blockData = projectBlockDataSignal.get;
  const [project, setProject] = projectSignal;
  const [activeFilters, _setActiveFilters] = blockActiveFilters;
  const [ownershipFilters, _setOwnershipFilters] = blockOwnershipFilters;
  const _viewType = blockViewType.get;
  const [searchParams] = useSearchParams();
  const [_selectedItems, _setSelectedItems] = blockSelectedItems;
  const [fileSort, _setFileSort] = blockFileSort;
  const [fileSearchQuery, _setFileSearchQuery] = blockFileSearchQuery;
  // const { bulkDelete, bulkCopy, bulkMoveToFolder } = useItemOperations();
  const userId = useUserId();
  const historyTree = useHistoryTree();
  const deletedTree = useDeletedTree();
  const [filteredFileTree, setFilteredFileTree] = blockFilteredFileTreeStore;
  const [isDragging, setIsDragging] = createSignal(false);

  const showProjectsFirst = blockShowProjectsFirst.get;
  const showTrash = blockShowTrash.get;
  const viewSize = blockViewSize.get;
  const viewSortList = blockViewType.get;

  createEffect(() => {
    const blockData_ = blockData();
    if (!blockData_) return;
    if (
      blockData_.projectMetadata.id === 'root' ||
      blockData_.projectMetadata.id === 'trash'
    ) {
      setProject(blockData_.projectMetadata);
    } else {
      // Get metadata from history tree so that it correctly updates on history refetch
      const project = untrack(
        () =>
          historyTree().itemMap[blockData_.projectMetadata.id]?.item as Project
      );
      if (project) {
        setProject(project);
        const persistedViewFilter_ = persitedViewFilter(project);
        blockActiveFilters.set(persistedViewFilter_.activeFilters);
        blockOwnershipFilters.set(persistedViewFilter_.ownershipFilters);
        blockFileSearchQuery.set(persistedViewFilter_.fileSearchQuery);
        blockFileSort.set(persistedViewFilter_.fileSort);
        blockShowProjectsFirst.set(persistedViewFilter_.showProjectsFirst);
        blockShowTrash.set(persistedViewFilter_.showTrash);
        blockViewSize.set(persistedViewFilter_.viewSize);
        blockViewType.set(persistedViewFilter_.viewSortList);
      }
    }
  });

  const projectId = useBlockId();

  // onchange of any of the block signals, save the value to the persisted view filter
  createEffect(() => {
    savePersistedViewFilter(project(), 'activeFilters', activeFilters());
    savePersistedViewFilter(project(), 'ownershipFilters', ownershipFilters());
    savePersistedViewFilter(project(), 'fileSearchQuery', fileSearchQuery());
    savePersistedViewFilter(project(), 'fileSort', fileSort());
    savePersistedViewFilter(
      project(),
      'showProjectsFirst',
      showProjectsFirst()
    );
    savePersistedViewFilter(project(), 'showTrash', showTrash());
    savePersistedViewFilter(project(), 'viewSize', viewSize());
    savePersistedViewFilter(project(), 'viewSortList', viewSortList());
  });

  // This effect is triggered when the URL query params change.
  createEffect(async () => {
    const subProjectId_ = () => searchParams.projectId;
    const subProjectId = subProjectId_();

    if (typeof subProjectId === 'string') {
      // Case 1: URL has a project ID - load that project
      const maybeProjectResponse =
        await storageServiceClient.projects.getProject({
          id: subProjectId,
        });
      if (isErr(maybeProjectResponse)) {
        return console.error(maybeProjectResponse);
      }
      const [, projectResponse] = maybeProjectResponse;
      const project = projectResponse.projectMetadata;
      setProject(project);
    } else {
      // Case 2: No project ID in URL - reset to blockData's project
      const blockData_ = blockData();
      if (blockData_) {
        setProject(blockData_.projectMetadata);
      }
    }
  });

  const hasSearch = () => fileSearchQuery().trim().length > 0;
  const hasFilters = () => {
    return activeFilters().length > 0 || ownershipFilters().length > 0;
  };

  const fileTreeSource = () => {
    if (project()?.id === 'trash') {
      return deletedTree();
    }
    return historyTree();
  };

  // Here we are rebuilding the file tree every time the search or filter changes. Which is inefficient. But for now, it is performant enough.
  createEffect(() => {
    if (hasFilters() || hasSearch()) {
      const items = Object.values(fileTreeSource().itemMap).map(
        (item) => item.item
      );
      const filteredItems = items.filter(
        (item) =>
          fuzzy.test(fileSearchQuery(), item.name) &&
          matchesActiveFilters(
            item,
            activeFilters(),
            userId() || '',
            ownershipFilters()
          )
      );
      setFilteredFileTree(() =>
        buildFileTreeWithAncestors(filteredItems, items)
      );
    }
  });

  const currentFileTree = createMemo(() => {
    if (hasFilters() || hasSearch()) {
      return filteredFileTree;
    }
    return fileTreeSource();
  });

  const [expandedProjects, setExpandedProjects] = blockExpandedProjectsStore;
  const [preSearchExpandedProjects, setPreSearchExpandedProjects] =
    blockPreSearchExpandedProjectsStore;

  // If there is only one project, expand it (primarily for Onboarding visibility)
  createEffect(() => {
    if (
      currentFileTree().rootItems.filter((item) => item.item.type === 'project')
        .length === 1
    ) {
      setExpandedProject(
        currentFileTree().rootItems[0].item.id,
        true,
        blockExpandedProjectsStore
      );
    }
  });

  // When there is a search, we want to save the expanded state of the projects so that we can restore it when the search is cleared.
  createEffect((prev) => {
    const current = hasSearch();
    if (current && !prev) {
      // Save current state before modifying
      setPreSearchExpandedProjects({ ...expandedProjects });

      // Find all project items and expand them
      const projectItems = Object.values(currentFileTree().itemMap)
        .filter((node) => node.item.type === 'project')
        .map((node) => node.item);

      setExpandedProjects(() => {
        const newState: { [key: string]: boolean } = {};
        projectItems.forEach((project) => {
          newState[project.id] = true;
        });
        return newState;
      });
    } else if (!current && prev) {
      // Restore previous state
      setExpandedProjects((prev) => {
        const newState = { ...prev };
        Object.keys({ ...prev, ...preSearchExpandedProjects }).forEach(
          (key) => {
            newState[key] = preSearchExpandedProjects[key] ?? false;
          }
        );
        return newState;
      });
    }
    return current;
  });

  const handleFileUpload = async (files: UploadInput[]) => {
    if (files.length === 0) return;
    const currentProject = project();

    // Don't allow uploads to root or trash
    if (
      !currentProject ||
      currentProject.id === 'root' ||
      currentProject.id === 'trash'
    ) {
      toast.failure('Cannot upload files to this location');
      return;
    }

    try {
      const results = await uploadFiles(files, 'dss', {
        projectId: currentProject.id,
      });

      const uploads = results.filter((result) => !result.failed);

      // show documents that were immediately uploaded
      const successfulUploads = uploads.filter((result) => !result.pending);
      if (successfulUploads.length > 0) {
        refetchResources();
      }

      // wait for pending folder uploads to finish upload before refetching resources
      const pendingFolderUploads = uploads
        .filter((result) => result.pending)
        .filter((result) => result.type === 'folder')
        .map((result) => result.projectId);
      if (pendingFolderUploads.length > 0) {
        await Promise.all(pendingFolderUploads);
        refetchResources();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.failure('Upload failed. Please try again.');
    }
  };

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
          disabled: project()?.id === 'trash' || project()?.id === 'root',
          folder: ENABLE_FOLDER_UPLOAD,
        }}
      >
        <Show
          when={
            isDragging() &&
            project()?.id !== 'trash' &&
            project()?.id !== 'root'
          }
        >
          <div class="hidden sm:flex flex-col absolute top-0 left-0 w-full h-full backdrop-blur-sm bg-accent/10 items-center justify-center space-y-3 z-3">
            <Files class="w-[80px] h-[80px] text-ink" />
            <h3 class="text-2xl font-semibold text-ink">
              Upload to {project()?.name ?? 'folder'}
            </h3>
            <p class="text-sm text-ink-muted">
              <Show
                when={ENABLE_FOLDER_UPLOAD}
                fallback="Drop files here to upload"
              >
                Drop files or folders here to upload
              </Show>
            </p>
          </div>
        </Show>
        <TopBar />
        <UnifiedListView defaultFilterOptions={{ projectFilter: projectId }} />
      </div>
    </DocumentBlockContainer>
  );
};

export default Block;
