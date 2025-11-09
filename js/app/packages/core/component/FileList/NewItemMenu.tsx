import { MenuItem } from '@core/component/Menu';
import { usePaywallState } from '@core/constant/PaywallState';
import { createMarkdownFile } from '@core/util/create';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { uploadFile } from '@core/util/upload';
import Chat from '@icon/duotone/chat-duotone.svg';
import FileMd from '@icon/duotone/file-md-duotone.svg';
import Canvas from '@icon/duotone/pencil-circle-duotone.svg';
import Folder from '@icon/regular/folder.svg';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { postNewHistoryItem } from '@service-storage/history';
import { newBlankDocument } from '@service-storage/util/newBlankDocument';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { useSplitLayout } from '../../../app/component/split-layout/layout';
import { toast } from '../Toast/Toast';

export async function handleNewChat(args: {
  projectId?: string;
  afterOnClick?: () => void;
  openInSplit?: boolean;
}) {
  const { projectId, afterOnClick, openInSplit } = args;
  const navigate = useNavigate();
  const { replaceOrInsertSplit } = useSplitLayout();
  const { showPaywall } = usePaywallState();

  const maybeResult = await cognitionApiServiceClient.createChat({
    name: 'New Chat',
    projectId,
  });

  if (isPaymentError(maybeResult)) {
    console.error(maybeResult);
    showPaywall();
    return;
  }
  if (isErr(maybeResult)) {
    console.error(maybeResult);
    return;
  }

  const newChatId = maybeResult[1].id;
  postNewHistoryItem('chat', newChatId);
  if (openInSplit) {
    replaceOrInsertSplit({
      type: 'chat',
      id: newChatId,
    });
  } else {
    navigate(`/chat/${newChatId}`);
  }
  afterOnClick?.();
}

export async function handleNewNote(args: {
  projectId?: string;
  afterOnClick?: () => void;
  openInSplit?: boolean;
}) {
  const { projectId, afterOnClick, openInSplit } = args;
  const navigate = useNavigate();
  const { replaceOrInsertSplit } = useSplitLayout();
  const documentId = await createMarkdownFile({ projectId });
  if (!documentId) {
    toast.failure('Failed to create document');
    return;
  }
  postNewHistoryItem('document', documentId);
  if (openInSplit) {
    replaceOrInsertSplit({
      type: 'md',
      id: documentId,
    });
  } else {
    navigate(`/md/${documentId}`);
  }
  afterOnClick?.();
}

export async function handleNewCanvas(args: {
  projectId?: string;
  afterOnClick?: () => void;
  openInSplit?: boolean;
}) {
  const { projectId, afterOnClick, openInSplit } = args;
  const navigate = useNavigate();
  const { replaceOrInsertSplit } = useSplitLayout();

  const emptyCanvasFile = newBlankDocument('canvas');
  if (!emptyCanvasFile) return console.error('Failed to create new canvas');

  const uploadResult = await uploadFile(emptyCanvasFile, 'dss', {
    ...(projectId ? { projectId } : {}),
    skipAnalytics: true,
    fileType: 'canvas',
  });
  if (uploadResult.failed || uploadResult.type !== 'document') {
    console.error('Failed to upload new canvas');
    return;
  }
  const documentId = uploadResult.documentId;
  postNewHistoryItem('document', documentId);

  if (openInSplit) {
    replaceOrInsertSplit({
      type: 'canvas',
      id: documentId,
    });
  } else {
    navigate(`/canvas/${documentId}`);
  }
  afterOnClick?.();
}

interface NewItemMenuItemsProps {
  setIsCreatingProject: (isCreatingProject: boolean) => void;
  parentId?: string;
  setIsExpanded?: (isExpanded: boolean) => void;
}

export function NewItemMenuItems(props: NewItemMenuItemsProps) {
  const newNote = createCallback(async () => {
    await handleNewNote({
      projectId: props.parentId,
      openInSplit: true,
    });
  });

  const newChat = createCallback(async () => {
    await handleNewChat({
      projectId: props.parentId,
      openInSplit: true,
    });
  });

  const newCanvas = createCallback(async () => {
    await handleNewCanvas({
      projectId: props.parentId,
      openInSplit: true,
    });
  });

  const newFolder = () => {
    props.setIsExpanded?.(true);
    props.setIsCreatingProject(true);
  };

  return (
    <>
      <MenuItem text="Folder" icon={Folder} onClick={newFolder} />
      <MenuItem text="Note" icon={FileMd} onClick={newNote} />
      <MenuItem text="Chat" icon={Chat} onClick={newChat} />
      <MenuItem text="Canvas" icon={Canvas} onClick={newCanvas} />
    </>
  );
}
