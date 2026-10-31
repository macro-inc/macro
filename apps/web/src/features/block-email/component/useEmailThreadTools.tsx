import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { downloadEmailMessageEml } from '@app/features/email-message/eml-download-adapter';
import type { EmailThreadListNavigation } from '@app/features/email-thread/context/email-thread-context';
import { useEmailThreadState } from '@app/features/email-thread/context/email-thread-state-context';
import { selectEmlMessage } from '@app/features/email-thread/core/thread-messages';
import {
  emailSenderBucket,
  makeMoveToProjectAction,
} from '@app/features/next-soup/actions';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  trashEmails,
} from '@app/features/next-soup/utils';
import { EmailReminderStatus } from '@app/features/reminders/email-reminder-status';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildEntityData } from '@entity';
import IconShared from '@icon/share.svg';
import CheckBoldIcon from '@icon/system/bold/check-bold.svg?component-solid';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import EnvelopeSimpleIcon from '@icon/system/regular/envelope-simple.svg';
import EnvelopeSimpleOpenIcon from '@icon/system/regular/envelope-simple-open.svg';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import SignalIcon from '@icon/system/regular/wave-sine.svg';
import NoiseIcon from '@icon/system/regular/waveform.svg';
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
  const moveToProjectAction = makeMoveToProjectAction({
    userId: useUserId(),
  });

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

  // The thread's own Signal or Noise placement, when the list row that opened
  // it said; unknown offers both sender moves, as in Search.
  const senderBucket = () => emailSenderBucket(emailEntity());

  // A thread belongs to the mailbox it came to, so being its owner is being
  // one of the user's inboxes; the row's ownerId isn't known before it loads.
  const canMoveToFolder = () => {
    const entity = emailEntity();
    return !!entity && moveToProjectAction.canMoveType(entity) && isOwnThread();
  };

  const moveToFolder = () => {
    const entity = emailEntity();
    if (!entity || !canMoveToFolder()) return;
    fireAndForget(moveToProjectAction.execute([entity]), 'email-thread-tools');
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
      fireAndForget(
        props.listNavigation.markDone(emailCtx.archiveThread),
        'email-thread-tools'
      );
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
      fireAndForget(
        openEntityInSplitFromUnifiedList(nextRow.original, {}),
        'email-thread-tools'
      );
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

  const emlMessage = () => {
    const thread = emailCtx.thread();
    return thread ? selectEmlMessage(thread) : undefined;
  };

  const downloadEml = () => {
    const message = emlMessage();
    if (!message) return;
    fireAndForget(downloadEmailMessageEml(message), 'email-thread-tools');
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
      label: 'Mark Done',
      icon: CheckIcon,
      action: toggleMarkDone,
      condition: () => isOwnThread() && !isDone(),
      hotkeyToken: TOKENS.entity.action.markDone,
    },
    {
      label: 'Mark Not Done',
      icon: CheckBoldIcon,
      action: toggleMarkDone,
      condition: () =>
        isOwnThread() && isDone() && emailCtx.canMarkThreadNotDone(),
      hotkeyToken: TOKENS.entity.action.markNotDone,
    },
    {
      label: 'Mark Unread',
      icon: EnvelopeSimpleOpenIcon,
      action: toggleMarkUnread,
      condition: () => isOwnThread() && !emailCtx.isThreadMarkedUnread(),
      hotkeyToken: TOKENS.entity.action.markUnread,
    },
    {
      label: 'Mark Read',
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
        fireAndForget(
          openChatWithAgent({
            type: 'email',
            id: threadId,
            name: props.title,
          }),
          'email-thread-tools'
        );
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
        return !!entity && canMoveToFolder();
      },
    },
    {
      group: 'file',
      get label() {
        return t('entityActions.downloadEml');
      },
      icon: DownloadIcon,
      action: downloadEml,
      condition: () => !!emlMessage(),
    },
    {
      group: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      action: trashThread,
      condition: isOwnThread,
      hotkeyToken: TOKENS.email.trash,
    },
    {
      group: 'sender',
      label: 'Sender → Signal',
      icon: SignalIcon,
      action: () => emailCtx.markSenderSignal(),
      condition: () =>
        isOwnThread() &&
        emailCtx.canActOnSender() &&
        senderBucket() !== 'signal',
    },
    {
      group: 'sender',
      label: 'Sender → Noise',
      icon: NoiseIcon,
      action: () => emailCtx.markSenderNoise(),
      condition: () =>
        isOwnThread() &&
        emailCtx.canActOnSender() &&
        senderBucket() !== 'noise',
    },
    {
      group: 'sender',
      label: 'Block Sender',
      icon: ProhibitIcon,
      action: () => emailCtx.blockSender(),
      condition: () => isOwnThread() && emailCtx.canActOnSender(),
    },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () => {
        const threadId = emailCtx.thread()?.db_id;
        if (!threadId) return;
        fireAndForget(
          openChatWithAgent({
            type: 'email',
            id: threadId,
            name: props.title,
          }),
          'email-thread-tools'
        );
      },
      condition: () => !!emailCtx.thread()?.db_id,
      buttonComponent: (control) => {
        const id = emailCtx.thread()?.db_id;
        return id ? (
          <ChatWithAgentButton
            grouped={control.grouped}
            entity={{ type: 'email', id, name: props.title }}
          />
        ) : null;
      },
    },
    shareTool,
  ];

  return {
    openShare,
    isInvite,
    emailEntity,
    permissions: () => getPermissions(emailCtx.thread()?.access_level),
    tools,
    menuTools: emailActions,
    controls: {
      get reminder() {
        const entity = emailEntity();
        return entity && isOwnThread() ? (
          <EmailReminderStatus
            grouped={!isTouchDevice()}
            entity={entity}
            onSaved={async () => {
              const navigation = props.listNavigation;
              if (navigation?.afterReminderSaved)
                await navigation.afterReminderSaved();
              else if (navigation?.canNext()) navigation.next();
              else if (navigation?.canPrevious()) navigation.previous();
            }}
          />
        ) : undefined;
      },
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
