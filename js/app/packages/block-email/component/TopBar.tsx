import { useMaybeSoup } from '@app/component/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  trashEmails,
} from '@app/component/next-soup/utils';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@app/component/ResponsiveBlockToolbar';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/component/ChatWithAgentButton';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import CheckIcon from '@icon/regular/check.svg';
import { AnimatedTaskIcon } from '@macro-icons/wide/animating/task';
import IconShared from '@macro-icons/wide/share.svg';
import TagIcon from '@icon/regular/tag.svg';
import ProhibitIcon from '@icon/regular/prohibit.svg';
import TrashIcon from '@icon/regular/trash.svg';
import {
  EmailPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from './EmailPropertiesModal';
import { createSignal } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { buildMentionMarkdownString } from '@lexical-core';
import { useEmailLinksQuery } from '@queries/email/link';
import { isMobile } from '@core/mobile/isMobile';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
}) {
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const { popoverSplit } = useSplitLayout();
  const shareCtx = useShareDialogContext();
  const emailCtx = useEmailContext();
  const soup = useMaybeSoup();
  const linksQuery = useEmailLinksQuery();

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

    const toastId = toast.success(
      'Moved to Trash',
      undefined,
      [
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
      10_000
    );

    handle.done.catch(() => {
      toast.failure('Failed to move to Trash');
    });
  };

  const openTaskCompose = () => {
    const threadId = emailCtx.thread()?.db_id;
    if (!threadId) return;
    const title =
      props.title.length > 70 ? `${props.title.slice(0, 70)}...` : props.title;
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        initialTitle: title,
        initialContent: buildMentionMarkdownString({
          type: 'document',
          documentId: threadId,
          documentName: props.title,
          blockName: 'email',
        }),
      },
    });
  };

  const tools: BlockTool[] = [
    {
      label: 'Done',
      icon: CheckIcon,
      action: () => {
        const command = getActiveCommandByToken(TOKENS.entity.action.markDone);
        if (command) {
          runCommand(command);
        } else {
          emailCtx.archiveThread();
        }
      },
      condition: isOwnThread,
    },
    {
      label: 'Trash',
      icon: TrashIcon,
      action: trashThread,
      condition: isOwnThread,
    },
    {
      label: 'Block Sender',
      icon: ProhibitIcon,
      action: () => emailCtx.blockSender(),
      condition: isOwnThread,
    },
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      buttonComponent: () => <EmailPropertiesButton buttonSize="sm" />,
    },
    {
      label: 'Create Task',
      icon: AnimatedTaskIcon,
      action: openTaskCompose,
      buttonComponent: () => {
        const [hovering, setHovering] = createSignal(false);
        return (
          <div class="border border-edge-muted flex items-stretch rounded-xs">
            <button
              class="h-7 px-2 flex items-center gap-1 text-xs hover:bg-hover hover-transition-bg"
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
              onClick={openTaskCompose}
            >
              <div class="size-4">
                <AnimatedTaskIcon triggerAnimation={hovering()} />
              </div>
              <span class="text-ink">Task</span>
            </button>
          </div>
        );
      },
    },
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
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      condition: () => ENABLE_EMAIL_SHARING,
      buttonComponent: () => <ShareTrigger />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          class="ph-no-capture"
          iconType={isInvite() ? 'emailInvite' : 'email'}
          colorIcon={isInvite()}
          label={isMobile() ? '' : props.title}
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

      <ResponsiveBlockToolbar
        tools={tools}
        ops={[]}
        id={props.id}
        itemType="email"
        name={props.title}
      />
    </>
  );
}
