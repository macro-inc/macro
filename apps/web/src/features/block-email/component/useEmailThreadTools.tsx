import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import type { EmailThreadListNavigation } from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { makeMoveToProjectAction } from '@app/features/next-soup/actions';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  trashEmails,
} from '@app/features/next-soup/utils';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import { buildEntityData } from '@entity';
import IconShared from '@icon/share.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import EnvelopeSimpleOpenIcon from '@phosphor/envelope-simple-open.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import ProhibitIcon from '@phosphor/prohibit.svg';
import TrashIcon from '@phosphor/trash.svg';
import NoiseIcon from '@phosphor/waveform.svg';
import CheckBoldIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { useEmailLinksQuery } from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';

export type EmailThreadToolsOptions = {
  id: string;
  title: string;
  isDraft?: boolean;
  onCreateTask?: () => void;
  onMarkedUnread?: () => void;
  onDeleted?: () => void;
  listNavigation?: EmailThreadListNavigation;
};

export function useEmailThreadTools(props: EmailThreadToolsOptions) {
  const emailCtx = useEmailThreadState();
  const openShare = useShareModal(() => {
    const thread = emailCtx.thread();
    if (!thread) return;
    return {
      id: props.id,
      blockAlias: 'email',
      itemType: 'email',
      name: props.title,
      userPermissions: getPermissions(thread.access_level),
    };
  });
  const soup = useMaybeSoup();
  const linksQuery = useEmailLinksQuery();
  const moveToProjectAction = makeMoveToProjectAction();

  const isInvite = () => {
    const row = soup?.items.get(props.id);
    const entity = row?.original;
    return entity?.type === 'email' && entity.hasIcsAttachment === true;
  };

  const isOwnThread = () => {
    const thread = emailCtx.thread();
    if (!thread || !queryReadyGate(linksQuery)) return false;
    return linksQuery.data.links.some((link) => link.id === thread.link_id);
  };

  const isDone = () => emailCtx.isThreadDone();

  const emailEntity = () => {
    const soupEntity = soup?.items.get(props.id)?.original;
    if (soupEntity?.type === 'email') return soupEntity;

    const thread = emailCtx.thread();
    return buildEntityData({
      id: props.id,
      name: props.title,
      blockName: 'email',
      projectId: thread?.project_id ?? undefined,
      isRead: thread?.is_read,
      isDraft: props.isDraft,
      done: thread ? !thread.inbox_visible : undefined,
    });
  };

  const moveToFolder = () => {
    const entity = emailEntity();
    if (!entity || !moveToProjectAction.canExecute(entity)) return;
    void moveToProjectAction.execute([entity]);
  };

  // A send-only thread is permanently done, so neither half of the toggle
  // does anything — hide it rather than offer a no-op.
  const showMarkDoneToggle = () => !isDone() || emailCtx.canMarkThreadNotDone();

  const toggleMarkDone = () => {
    if (isDone()) {
      emailCtx.markThreadNotDone();
      return;
    }
    if (props.listNavigation) {
      props.listNavigation.markDone(emailCtx.archiveThread);
      return;
    }
    // Prefer the active Mark done command so it drives soup navigation and
    // notifications; fall back to archiving the thread directly. A command
    // can be found but still decline (condition/handler returns false, e.g.
    // the triage registration when not opened from inbox/mail), so gate on
    // it actually capturing.
    const command = getActiveCommandByToken(TOKENS.entity.action.markDone);
    if (command && runCommand(command).commandCaptured) return;
    emailCtx.archiveThread();
  };

  const toggleMarkUnread = () => {
    if (emailCtx.isThreadMarkedUnread()) {
      emailCtx.markThreadRead();
    } else if (emailCtx.markThreadUnread()) {
      props.onMarkedUnread?.();
    }
  };

  const trashThread = () => {
    const thread = emailCtx.thread();
    if (!thread?.db_id) return;

    // Calculate next row before trashing so we can navigate to it
    const nextRow = (() => {
      if (!soup) return undefined;
      const currentIndex = soup.focus.index();
      return soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);
    })();

    const handle = trashEmails([{ id: thread.db_id, linkId: thread.link_id }]);

    if (props.onDeleted) {
      props.onDeleted();
    } else if (soup && nextRow) {
      soup.selection.clear();
      soup.focus.set(nextRow.id);
      openEntityInSplitFromUnifiedList(nextRow.original, {});
    }

    const toastId = toast.success('Moved to Trash', {
      actions: [
        {
          label: 'Undo',
          icon: ArrowCounterClockwise,
          onClick: () => {
            if (toastId != null) toast.dismiss(toastId);
            handle.undo().then(
              () => toast.success('Restored from Trash'),
              () => toast.failure('Failed to restore from Trash')
            );
          },
        },
      ],
      duration: 10_000,
    });

    handle.done.catch(() => {
      toast.failure('Failed to move to Trash');
    });
  };

  const shareTool: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    condition: () => ENABLE_EMAIL_SHARING,
    buttonComponent: () => (
      <ShareTrigger onClick={openShare} id={props.id} blockType="email" />
    ),
    focusTarget: getShareDrawerRecipientInput,
  };

  const emailActions: BlockTool[] = [
    {
      label: 'Mark done',
      icon: CheckIcon,
      action: toggleMarkDone,
      condition: () => isOwnThread() && !isDone(),
      hotkeyToken: TOKENS.entity.action.markDone,
    },
    {
      label: 'Mark as not done',
      icon: CheckBoldIcon,
      action: toggleMarkDone,
      condition: () =>
        isOwnThread() && isDone() && emailCtx.canMarkThreadNotDone(),
      hotkeyToken: TOKENS.entity.action.markNotDone,
    },
    {
      label: 'Mark unread',
      icon: EnvelopeSimpleOpenIcon,
      action: toggleMarkUnread,
      condition: () => isOwnThread() && !emailCtx.isThreadMarkedUnread(),
      hotkeyToken: TOKENS.entity.action.markUnread,
    },
    {
      label: 'Mark read',
      icon: EnvelopeSimpleIcon,
      action: toggleMarkUnread,
      condition: () => isOwnThread() && emailCtx.isThreadMarkedUnread(),
      hotkeyToken: TOKENS.entity.action.markRead,
    },
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () => {
        const threadId = emailCtx.thread()?.db_id;
        if (!threadId) return;
        openChatWithAgent({ type: 'email', id: threadId, name: props.title });
      },
      condition: () => !!emailCtx.thread()?.db_id,
    },
    {
      label: 'Create task',
      icon: TaskIcon,
      action: () => props.onCreateTask?.(),
      condition: () => !!props.onCreateTask && !!emailCtx.thread()?.db_id,
    },
    shareTool,
    {
      group: 'file',
      label: 'Move to folder',
      icon: ArrowRightIcon,
      action: moveToFolder,
      condition: () => {
        const entity = emailEntity();
        return !!entity && moveToProjectAction.canExecute(entity);
      },
    },
    {
      group: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      action: trashThread,
      condition: isOwnThread,
    },
    {
      group: 'sender',
      label: 'Sender → Noise',
      icon: NoiseIcon,
      action: () => emailCtx.markSenderNoise(),
      condition: isOwnThread,
    },
    {
      group: 'sender',
      label: 'Block Sender',
      icon: ProhibitIcon,
      action: () => emailCtx.blockSender(),
      condition: isOwnThread,
    },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () => {
        const threadId = emailCtx.thread()?.db_id;
        if (!threadId) return;
        openChatWithAgent({ type: 'email', id: threadId, name: props.title });
      },
      condition: () => !!emailCtx.thread()?.db_id,
      buttonComponent: () => {
        const id = emailCtx.thread()?.db_id;
        return id ? (
          <ChatWithAgentButton
            entity={{ type: 'email', id, name: props.title }}
          />
        ) : null;
      },
    },
    shareTool,
  ];

  return {
    isInvite,
    emailEntity,
    permissions: () => getPermissions(emailCtx.thread()?.access_level),
    tools,
    menuTools: emailActions,
    controls: {
      get isOwnThread() {
        return isOwnThread();
      },
      get isDone() {
        return isDone();
      },
      get isUnread() {
        return emailCtx.isThreadMarkedUnread();
      },
      get canToggleDone() {
        return showMarkDoneToggle();
      },
      onToggleDone: toggleMarkDone,
      onToggleUnread: toggleMarkUnread,
    },
  };
}
