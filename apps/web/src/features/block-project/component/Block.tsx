import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  createSoupState,
  type SoupState,
} from '@app/features/next-soup/create-soup-state';
import { defineQueryFilters } from '@app/features/next-soup/filters/filter-store';
import { soupItemMatchesProjectMembership } from '@app/features/next-soup/filters/query-filters';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { SoupViewList } from '@app/features/next-soup/soup-view/soup-view';
import { SoupViewContextProvider } from '@app/features/next-soup/soup-view/soup-view-context';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { toast } from '@core/component/Toast/Toast';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import {
  handleFileFolderDrop,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import { refetchSoupEntity } from '@queries/soup/cache';
import { refetchResources } from '@service-storage/util/refetchResources';
import { type Component, createSignal, Show } from 'solid-js';
import { ModalsProvider } from './ModalsProvider';
import { ProjectSidePanelSections } from './sidepanel/ProjectSidePanelSections';
import { TopBar } from './TopBar';

// HACK: prevent lint error on custom directive
false && fileFolderDrop;
false && fileSelector;

const PROJECT_ENTITY_TYPES = ['document', 'task', 'chat', 'project', 'email'];

const Block: Component = () => {
  useBlockEntityCommands();
  const [isDragging, setIsDragging] = createSignal(false);
  const projectId = useBlockId();
  const isSpecialProject = getIsSpecialProject(projectId);

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

      // refetch successfully uploaded documents into soup
      const successfulUploads = uploads.filter((result) => !result.pending);
      for (const upload of successfulUploads) {
        if (upload.type === 'document') {
          refetchSoupEntity(upload.documentId, 'document');
        }
      }
      if (successfulUploads.length > 0) {
        refetchResources();
      }

      // wait for pending folder uploads to finish upload before refetching resources
      const pendingFolderUploads = uploads
        .filter((result) => result.pending)
        .filter((result) => result.type === 'folder')
        .map((result) => result.projectId);
      if (pendingFolderUploads.length > 0) {
        const resolved = await Promise.all(pendingFolderUploads);
        for (const projectId of resolved) {
          if (projectId) {
            refetchSoupEntity(projectId, 'project');
          }
        }
        refetchResources();
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.failure('Upload failed. Please try again.');
    }
  };

  const projectSoup = createSoupState({
    initialPredicates: { and: ['project-content'] },
    predicateConfigs: [
      {
        id: 'project-content',
        predicate: (entity: { type: string }) =>
          PROJECT_ENTITY_TYPES.includes(entity.type),
      },
    ],
  });

  return (
    <DocumentBlockContainer>
      <div
        class="size-full bg-surface flex flex-col relative"
        use:fileFolderDrop={{
          onDragStart: () => setIsDragging(true),
          onDragEnd: () => setIsDragging(false),
          onDrop: (fileEntries, folderEntries) => {
            handleFileFolderDrop(fileEntries, folderEntries, handleFileUpload);
          },
          disabled: isSpecialProject,
        }}
      >
        <ModalsProvider>
          <Show when={isDragging() && !isSpecialProject}>
            <FileDropOverlay>Upload to this folder</FileDropOverlay>
          </Show>
          <SidePanel.Layout defaultOpen={false}>
            <Show when={!isSpecialProject}>
              <ProjectSidePanelSections />
            </Show>
            <div class="flex size-full min-w-0 flex-col overflow-hidden">
              <TopBar />
              <ProjectEntityList
                projectId={projectId}
                soup={projectSoup}
                // Scope is already attached by the block container so we can use that
                // Change this when we remove blocks
                scopeId={blockHotkeyScopeSignal.get()}
              />
            </div>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
};

const ProjectEntityList = (props: {
  scopeId: string;
  projectId: string;
  soup: SoupState;
}) => {
  return (
    <SoupContextProvider soup={props.soup}>
      <SoupViewContextProvider
        soup={props.soup}
        initialEnabled
        itemMembershipFilter={
          getIsSpecialProject(props.projectId)
            ? undefined
            : (item) => soupItemMatchesProjectMembership(item, props.projectId)
        }
        initialQuery={defineQueryFilters({
          include: {
            // Filter documents by project
            projectId: [props.projectId],
            // Filter chats by project
            chatProjectId: [props.projectId],
            // Filter projects by project (current project only)
            folderId: [props.projectId],
            // Filter emails by project
            emailProjectId: [props.projectId],
          },
          // Default 'inbox' view would hide archived/outbound-only threads
          emailView: 'all',
        })}
      >
        <SoupViewList customScrollbarHidden={true} scopeId={props.scopeId} />
      </SoupViewContextProvider>
    </SoupContextProvider>
  );
};

export default Block;
