import { useAnalytics } from '@app/component/analytics-context';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import { defineQueryFilters } from '@app/component/next-soup/filters/filter-store';
import { SoupContextProvider } from '@app/component/next-soup/soup-context';
import { SoupViewList } from '@app/component/next-soup/soup-view/soup-view';
import { SoupViewContextProvider } from '@app/component/next-soup/soup-view/soup-view-context';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { SplitPanelContext } from '@app/component/split-layout/context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { getIsSpecialProject } from '@block-project/isSpecial';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { ENABLE_PROJECT_VIEW_PREVIEW } from '@core/constant/featureFlags';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import {
  handleFileFolderDrop,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import { refetchSoupEntity } from '@queries/soup/cache';
import { refetchResources } from '@service-storage/util/refetchResources';
import { toast } from 'core/component/Toast/Toast';
import { type Component, createSignal, Show } from 'solid-js';
import { ModalsProvider } from './ModalsProvider';
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

  const previewPanel = useMaybePreviewPanel();

  const splitPanelContext = useSplitPanelOrThrow();
  const analytics = useAnalytics();

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

  // Preview can only work one level deep — don't register the toggle when
  // this project is already being rendered inside a preview panel.
  if (!previewPanel) {
    registerHotkey({
      hotkey: ['space'],
      scopeId: splitPanelContext.splitHotkeyScope,
      description: 'Toggle Preview',
      hotkeyToken: TOKENS.unifiedList.togglePreview,
      keyDownHandler: () => {
        if (projectSoup.previewEntity()) {
          projectSoup.setPreviewEntity(undefined);
          return true;
        }
        const focused = projectSoup.focus.id();
        if (!focused) return true;
        analytics.track('preview_panel_use');
        projectSoup.setPreviewEntity(focused);
        return true;
      },
      hide: true,
    });
  }

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
          <TopBar />
          <Show
            when={ENABLE_PROJECT_VIEW_PREVIEW}
            fallback={
              <ProjectEntityList
                projectId={projectId}
                soup={projectSoup}
                // Scope is already attached by the block container so we can use that
                // Change this when we remove blocks
                scopeId={blockHotkeyScopeSignal.get()}
              />
            }
          >
            <div class="flex size-full">
              <SplitPanelContext.Provider
                value={{
                  ...splitPanelContext,
                  halfSplitState: () =>
                    projectSoup.previewEntity() && projectSoup.focus.item()
                      ? { side: 'left', percentage: 30 }
                      : undefined,
                }}
              >
                <ProjectEntityList
                  projectId={projectId}
                  soup={projectSoup}
                  // Scope is already attached by the block container so we can use that
                  // Change this when we remove blocks
                  scopeId={blockHotkeyScopeSignal.get()}
                />
              </SplitPanelContext.Provider>
            </div>
          </Show>
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
        })}
      >
        <SoupViewList customScrollbarHidden={true} scopeId={props.scopeId} />
      </SoupViewContextProvider>
    </SoupContextProvider>
  );
};

export default Block;
