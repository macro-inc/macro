import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { makeMoveToProjectAction } from '@app/features/next-soup/actions';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  trashEmails,
} from '@app/features/next-soup/utils';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@components/app/ResponsiveBlockToolbar';
import { useSidePanel } from '@components/app/side-panel';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import { isMobile } from '@core/mobile/isMobile';
import { buildEntityData } from '@entity';
import { AnimatedNoiseIcon } from '@icon/wide-noise';
import IconShared from '@icon/wide-share.svg';
import { AnimatedTaskIcon } from '@icon/wide-task';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import EnvelopeSimpleOpenIcon from '@phosphor/envelope-simple-open.svg';
import ProhibitIcon from '@phosphor/prohibit.svg';
import TrashIcon from '@phosphor/trash.svg';
import CheckBoldIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { useEmailLinksQuery } from '@queries/email/link';
import { Button } from '@ui';
import { onCleanup, Show } from 'solid-js';
import { useEmailContext } from './EmailContext';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
  onCreateTask?: () => void;
}) {
  const splitPanel = useSplitPanel();
  const shareCtx = useShareDialogContext();
  const emailCtx = useEmailContext();
  const soup = useMaybeSoup();
  const linksQuery = useEmailLinksQuery();
  const sidePanel = useSidePanel();
  const moveToProjectAction = makeMoveToProjectAction();

  if (splitPanel?.splitHotkeyScope) {
    const reg = registerHotkey({
      hotkey: ']',
      scopeId: splitPanel.splitHotkeyScope,
      hotkeyToken: TOKENS.block.toggleSidePanel,
      description: 'Toggle Side Panel',
      keyDownHandler: () => {
        if (!sidePanel) return false;
        if (!sidePanel.hasSections()) return false;
        sidePanel.toggle();
        return true;
      },
    });
    onCleanup(() => reg.dispose());
  }

  const isInvite = () => {
    const row = soup?.items.get(props.id);
    const entity = row?.original;
    return entity?.type === 'email' && entity.hasIcsAttachment === true;
  };

  const isOwnThread = () => {
    const thread = emailCtx.thread();
    const links = linksQuery.data?.links;
    if (!thread || !links) return false;
    return links.some((link) => link.id === thread.link_id);
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
    } else {
      emailCtx.markThreadUnread();
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

    const handle = trashEmails([thread.db_id]);

    if (soup && nextRow) {
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
    action: () => shareCtx.open(),
    condition: () => ENABLE_EMAIL_SHARING,
    buttonComponent: () => <ShareTrigger />,
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
      icon: AnimatedTaskIcon,
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
      icon: AnimatedNoiseIcon,
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

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          class="ph-no-capture"
          iconType={isInvite() ? 'emailInvite' : 'email'}
          colorIcon={isInvite()}
          label={props.title}
          badges={
            props.isDraft
              ? [
                  <SplitHeaderBadge
                    text="draft"
                    tooltip="This is a Draft Email"
                  />,
                ]
              : undefined
          }
        />
      </SplitHeaderLeft>

      {/* Desktop-only Mark done button, sitting just left of the Previous item
          caret. On mobile this action lives in the bottom reply bar instead.
          A done thread shows a bold accent check and unarchives on click. */}
      <Show when={!isMobile()}>
        <SplitHeaderRight>
          {/* Read-state toggle. Viewing the thread marks it read, so it
              starts as Mark as unread; marking unread flips it to a bold
              accent closed envelope that re-marks the thread read. */}
          <Show when={isOwnThread()}>
            <Button
              class="p-1 rounded-lg"
              label={
                emailCtx.isThreadMarkedUnread()
                  ? 'Mark as read'
                  : 'Mark as unread'
              }
              hotkey={
                emailCtx.isThreadMarkedUnread()
                  ? TOKENS.entity.action.markRead
                  : TOKENS.entity.action.markUnread
              }
              onClick={toggleMarkUnread}
              // Keep focus (and the hotkey scope cmd-K reads) in the thread
              // content: focusing the header would hide its commands.
              onMouseDown={(e) => e.preventDefault()}
            >
              <Show
                when={emailCtx.isThreadMarkedUnread()}
                fallback={<EnvelopeSimpleOpenIcon class="size-4" />}
              >
                <EnvelopeSimpleIcon class="size-4 text-accent" />
              </Show>
            </Button>
          </Show>
          <Show when={isOwnThread() && showMarkDoneToggle()}>
            <Button
              class="p-1 rounded-lg"
              label={isDone() ? 'Mark as not done' : 'Mark done'}
              hotkey={
                isDone()
                  ? TOKENS.entity.action.markNotDone
                  : TOKENS.entity.action.markDone
              }
              onClick={toggleMarkDone}
              // Same focus-preservation as the read-state toggle above.
              onMouseDown={(e) => e.preventDefault()}
            >
              <Show when={isDone()} fallback={<CheckIcon class="size-4" />}>
                <CheckBoldIcon class="size-4 text-accent" />
              </Show>
            </Button>
          </Show>
        </SplitHeaderRight>
      </Show>

      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={emailActions}
        ops={[]}
        id={props.id}
        itemType="email"
        name={props.title}
      />
    </>
  );
}
