import { useIsAuthenticated } from '@core/auth';
import { EditableProvider } from '@core/component/Editable';
import {
  DropdownMenuContent,
  MenuItem,
  MenuItemRenameTrigger,
  MenuSeparator,
} from '@core/component/Menu';
import { EditingTextButton, TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { itemToSafeName } from '@core/constant/allBlocks';
import { DefaultFilename } from '@core/constant/filename';
import clickOutside from '@core/directive/clickOutside';
import { isErr } from '@core/util/maybeResult';
import { propsToHref } from '@core/util/url';
import Unpin from '@icon/fill/push-pin-slash-fill.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import CopySimple from '@icon/regular/copy-simple.svg';
import FolderIcon from '@icon/regular/folder.svg';
import PencilSimpleLine from '@icon/regular/pencil-simple-line.svg';
import Pin from '@icon/regular/push-pin.svg';
import TrashSimple from '@icon/regular/trash-simple.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { Project } from '@service-storage/generated/schemas/project';
import {
  postNewHistoryItem,
  removeHistoryItem,
} from '@service-storage/history';
import { pinItem, unpinItem, usePinnedIds } from '@service-storage/pins';
import { reverseFormatDocumentName } from '@service-storage/util/filename';
import { refetchResources } from '@service-storage/util/refetchResources';
import { useNavigate } from '@solidjs/router';
import {
  createMemo,
  createResource,
  createSignal,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { useSplitLayout } from '../../../app/component/split-layout/layout';
import { useItemOperations } from '../FileList/useItemOperations';
import { FileSelectDialog } from '../FileSelectDialog';
import { BarContext } from './Bar';

false && clickOutside;

function truncate(name: string, maxLength: number) {
  return name.length > maxLength ? `${name.slice(0, maxLength - 3)}...` : name;
}

interface FileMenuProps {
  formattedName?: string;
  name: string;
  id: string;
  itemType: ItemType;
  projectId?: string;
  projectName?: string;
  pinned?: boolean;
  togglePin?: () => void;
  rename?: (newName: string) => void;
  delete?: () => void;
  moveToProject?: (projectId: string, projectName: string) => void;
}
export function FileMenu(props: ParentProps<FileMenuProps>) {
  const [fileMenuOpen, setFileMenuOpen] = createSignal(false);
  const [showMoveToFolder, setShowMoveToFolder] = createSignal(false);
  const [fileMenuBtn, setFileMenuBtn] = createSignal<HTMLButtonElement | null>(
    null
  );
  const context = useContext(BarContext);
  if (!context) throw new Error('FileMenu must be used within a Bar');
  const truncation = context.truncation;
  const navigate = useNavigate();
  const formattedName = createMemo(() => props.formattedName ?? props.name);
  const { moveToFolder } = useItemOperations();

  const moveToFolderHandler = (folder: Project) => {
    moveToFolder({
      itemType: props.itemType,
      id: props.id,
      itemName: props.name,
      folderId: folder.id,
      folderName: folder.name,
    });
    setShowMoveToFolder(false);
  };

  const truncatedName = createMemo(() => {
    const name = formattedName();
    const maxLength = truncation().stage.fileNameLength;
    return truncate(name, maxLength);
  });

  return (
    <div class="flex flex-row items-center gap-0">
      <Show
        when={
          !truncation().stage.hideBreadcrumb &&
          props.projectId &&
          props.projectName
        }
        keyed
      >
        {(projectName) => (
          <>
            <TextButton
              theme="clear"
              icon={FolderIcon}
              text={truncate(projectName, 24)}
              onClick={() => {
                if (!props.projectId) return;
                navigate(
                  propsToHref({ fileType: 'project', id: props.projectId })
                );
              }}
              tooltip={
                projectName.length > 24 ? { label: projectName } : undefined
              }
            />
            {` / `}
          </>
        )}
      </Show>
      <EditableProvider
        editingComponent={
          <EditingTextButton
            handleSubmitEdit={props.rename}
            labelText={props.name}
            theme="clear"
            dynamicSizing
            showChevron
          />
        }
      >
        <DropdownMenu
          open={fileMenuOpen()}
          onOpenChange={setFileMenuOpen}
          sameWidth
        >
          <DropdownMenu.Trigger
            as={TextButton}
            theme="clear"
            text={truncatedName()}
            onClick={() => setFileMenuOpen((prev) => !prev)}
            showChevron
            tooltip={
              truncatedName().length < formattedName().length
                ? { label: formattedName() }
                : undefined
            }
            buttonRef={setFileMenuBtn}
          />

          <DropdownMenu.Portal>
            <DropdownMenuContent
              onCloseAutoFocus={() => fileMenuBtn()?.focus()}
            >
              <div
                use:clickOutside={(e) => {
                  const target = e.target as HTMLElement;
                  const menu = target.closest('.submenu');
                  if (!menu) {
                    setFileMenuOpen(false);
                  }
                }}
                class="w-full"
              >
                {props.children}
                <Show
                  when={
                    props.togglePin &&
                    props.pinned !== undefined &&
                    props.pinned !== null
                  }
                >
                  <MenuItem
                    text={props.pinned ? 'Unpin' : 'Pin'}
                    icon={props.pinned ? Unpin : Pin}
                    onClick={props.togglePin}
                  />
                </Show>
                <Show when={props.rename}>
                  <MenuItemRenameTrigger
                    text="Rename"
                    icon={PencilSimpleLine}
                    sideEffect={() => setFileMenuOpen(false)}
                  />
                </Show>
                <Show when={props.moveToProject}>
                  <MenuSeparator />
                  <MenuItem
                    text="Move to folder"
                    icon={ArrowRight}
                    onClick={() => setShowMoveToFolder(true)}
                  />
                </Show>
                <Show when={props.delete} keyed>
                  <MenuSeparator />
                  <MenuItem
                    onClick={props.delete}
                    text="Delete"
                    iconClass="text-failure"
                    icon={TrashSimple}
                  />
                </Show>
              </div>
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </EditableProvider>
      <FileSelectDialog
        itemId={props.id}
        open={showMoveToFolder()}
        setOpen={setShowMoveToFolder}
        selectableTypes={['project']}
        onSelect={moveToFolderHandler}
        title={`Move "${props.name}"`}
      />
    </div>
  );
}

const [documentResourceCounter, setDocumentResourceCounter] = createSignal(0, {
  internal: true,
  equals: false,
});
export function refetchDocumentFileMenuResource() {
  setDocumentResourceCounter(0);
}

interface DocumentFileMenuProps {
  documentId: string;
}
export function DocumentFileMenu(props: ParentProps<DocumentFileMenuProps>) {
  const isAuthenticated = useIsAuthenticated();
  const navigate = useNavigate();

  const { resetSplit } = useSplitLayout();

  const [documentResource, { refetch }] = createResource(
    () => {
      documentResourceCounter();
      const documentId = props.documentId;
      if (!documentId) return null;

      return { documentId };
    },
    storageServiceClient.getDocumentMetadata,
    { initialValue: undefined }
  );
  const documentMetadata = () => {
    const maybeResult = documentResource.latest;
    if (!maybeResult || isErr(maybeResult)) return;

    return maybeResult[1].documentMetadata;
  };
  const accessLevel = createMemo(() => {
    const maybeResult = documentResource.latest;
    if (!maybeResult || isErr(maybeResult)) return;

    return maybeResult[1].userAccessLevel;
  });

  const baseName = createMemo(() => {
    const meta = documentMetadata();
    if (!meta) return DefaultFilename;
    return reverseFormatDocumentName(meta.documentName, meta.fileType);
  });

  const documentName = createMemo(() => {
    const meta = documentMetadata();
    if (!meta) return DefaultFilename;
    return itemToSafeName({
      name: meta.documentName,
      fileType: meta.fileType,
      type: 'document',
    });
  });

  const projectId = createMemo(
    () => documentMetadata()?.projectId ?? undefined
  );
  const projectName = createMemo(
    () => documentMetadata()?.projectName ?? undefined
  );

  const pinnedIds = usePinnedIds();
  const isPinned = createMemo(() => pinnedIds().includes(props.documentId));
  const mutatePin = () => {
    if (isPinned()) {
      return unpinItem('document', props.documentId);
    }

    return pinItem('document', props.documentId);
  };

  const copyDocument = async () => {
    const documentId = props.documentId;
    if (!documentId) return;

    const result = await storageServiceClient.copyDocument({
      documentId,
      documentName: `${baseName()} copy`,
    });
    if (isErr(result)) return;

    const [, { documentId: id, fileType }] = result;
    const href = propsToHref({
      id,
      fileType,
    });
    if (!href) return;

    postNewHistoryItem('document', id);
    refetchResources();
    navigate(href);
  };

  const deleteHandler = async () => {
    const documentId = props.documentId;
    const userAccessLevel = accessLevel();
    if (!documentId || !userAccessLevel) return;

    const success =
      userAccessLevel === 'owner'
        ? (
            await storageServiceClient.deleteDocument({
              documentId,
            })
          )[1]?.success
        : await removeHistoryItem('document', documentId);
    if (!success) return toast.failure('Unable to delete file');

    resetSplit();

    refetchResources();
  };

  const renameHandler = async (documentName: string) => {
    if (!documentName.trim()) return toast.alert('Filename cannot be empty');

    const documentId = props.documentId;
    if (!documentId) return;

    const result = await storageServiceClient.editDocument({
      documentId,
      documentName,
    });
    if (isErr(result)) return toast.failure('Unable to rename file');

    refetch();
    refetchResources();
  };

  const moveToProjectHandler = async (
    projectId: string,
    projectName: string
  ) => {
    const result = await storageServiceClient.editDocument({
      documentId: props.documentId,
      projectId,
    });
    if (isErr(result)) return toast.failure('Unable to move file to project');

    refetch();
    refetchResources();
    toast.success(`${documentName()} moved to ${projectName}`);
  };

  return (
    /** this is to prevent it flickering with 'Unknown Filename' while loading */
    <Show when={documentMetadata()}>
      <FileMenu
        id={props.documentId}
        itemType="document"
        name={baseName()}
        formattedName={documentName()}
        projectId={projectId()}
        projectName={projectName()}
        delete={isAuthenticated() ? deleteHandler : undefined}
        rename={accessLevel() === 'owner' ? renameHandler : undefined}
        moveToProject={
          accessLevel() === 'owner' ? moveToProjectHandler : undefined
        }
      >
        {props.children}
        <Show when={isAuthenticated()}>
          <MenuItem
            onClick={mutatePin}
            text={isPinned() ? 'Unpin' : 'Pin'}
            icon={isPinned() ? Unpin : Pin}
          />
          <MenuItem
            onClick={copyDocument}
            text="Make a copy"
            icon={CopySimple}
          />
        </Show>
      </FileMenu>
    </Show>
  );
}
