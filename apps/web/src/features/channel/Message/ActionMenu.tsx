import { recordEmojiUsage } from '@core/component/Emoji/emojiUsage';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import StarIcon from '@icon/wide-star.svg';
import TaskIcon from '@icon/wide-task.svg';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import CopyIcon from '@phosphor/copy.svg';
import LinkIcon from '@phosphor/link.svg';
import EditIcon from '@phosphor/pencil-simple.svg';
import AddEmojiIcon from '@phosphor/smiley.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Button, cn, Layer } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  useMessage,
  useMessageActionMenuVisibility,
  useMessageActions,
} from './context';
import { EmojiReactionPopover } from './EmojiReactionPopover';
import { HoverActions } from './HoverActions';
import { renderIcon } from './render-icon';
import { Timestamp } from './Timestamp';
import type { MessageActionEvent, MessageActionHandler } from './types';

const QUICK_REACTION_EMOJIS = ['❤️', '👍', '😂'] as const;

type ActionId =
  | 'reply'
  | 'copy-link'
  | 'copy-message-text'
  | 'create-task'
  | 'chat'
  | 'edit'
  | 'delete';

type ActionItem = {
  id: ActionId;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string;
  onClick?: MessageActionHandler;
  destructive?: boolean;
  class?: string;
  iconClass?: string;
};

type ActionMenuProps = {
  class?: string;
  /**
   * Lead the toolbar with the message's timestamp. Used by grouped rows,
   * which have no header timestamp of their own.
   */
  showTimestamp?: boolean;
};

function ActionButton(props: {
  action: ActionItem;
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}) {
  return (
    <Button
      aria-label={props.action.label}
      data-message-action={props.action.id}
      onClick={props.onClick}
      tooltip={props.action.label}
      size="icon-sm"
      variant="ghost"
      class={props.action.class}
    >
      {renderIcon(
        props.action.icon,
        cn(props.action.iconClass, props.action.class)
      )}
    </Button>
  );
}

function ActionMenuContent(props: ActionMenuProps) {
  const message = useMessage();
  const actions = useMessageActions();
  const actionMenuVisibility = useMessageActionMenuVisibility();
  const [emojiMenuOpen, setEmojiMenuOpen] = createSignal(false);

  const handleEmojiMenuOpenChange = (isOpen: boolean) => {
    setEmojiMenuOpen(isOpen);
    actionMenuVisibility.setPersistent(isOpen);
  };

  onCleanup(() => actionMenuVisibility.setPersistent(false));

  const handleReaction = (emoji: string, event?: MessageActionEvent) => {
    void actions?.onReact?.({
      message: message(),
      event,
      emoji,
    });
  };

  const hasReactAction = () => actions?.onReact !== undefined;

  const composeActions: ActionItem[] = [
    {
      id: 'create-task',
      label: 'Task',
      icon: TaskIcon,
      onClick: actions?.onCreateTask,
    },
    {
      id: 'chat',
      label: 'Chat with Agent',
      icon: StarIcon,
      onClick: actions?.onChat,
    },
  ];
  const otherActions: ActionItem[] = [
    {
      id: 'reply',
      label: 'Reply',
      icon: ReplyIcon,
      onClick: actions?.onReply,
      iconClass: 'size-4',
    },
    {
      id: 'copy-link',
      label: 'Copy Link',
      icon: LinkIcon,
      onClick: actions?.onCopyLink,
      iconClass: 'size-4',
    },
    {
      id: 'copy-message-text',
      label: 'Copy Text',
      icon: CopyIcon,
      onClick: actions?.onCopyMessageText,
      iconClass: 'size-4',
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: EditIcon,
      onClick: actions?.onEdit,
      iconClass: 'size-4',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      onClick: actions?.onDelete,
      destructive: true,
      class: 'text-failure-ink',
      iconClass: 'size-4',
    },
  ];

  const visibleCompose = composeActions.filter((item) => item.onClick);
  const visibleOther = otherActions.filter((item) => item.onClick);
  const visibleActions = [...visibleCompose, ...visibleOther];

  return (
    <Show when={hasReactAction() || visibleActions.length > 0}>
      <HoverActions
        class={props.class}
        persistentVisible={emojiMenuOpen()}
        // Grouped rows (the ones carrying the toolbar timestamp) have text at
        // the very top; float the toolbar fully above so it never covers it.
        position={props.showTimestamp ? 'above' : 'straddle'}
      >
        <Layer depth={2}>
          <div
            class="flex flex-row bg-surface ring-1 ring-ink/10 p-1 shadow-md items-center rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={props.showTimestamp}>
              <Timestamp format="time" class="px-1.5 whitespace-nowrap" />
              <div class="w-px self-stretch bg-ink/10 mx-1" />
            </Show>
            <Show when={hasReactAction()}>
              <For each={QUICK_REACTION_EMOJIS}>
                {(emoji) => (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={(event) => {
                      recordEmojiUsage(emoji);
                      handleReaction(emoji, event);
                    }}
                    tooltip={`React ${emoji}`}
                    aria-label={`React ${emoji}`}
                    data-message-action="react-quick"
                    data-emoji={emoji}
                  >
                    <span class="text-base my-0">{emoji}</span>
                  </Button>
                )}
              </For>

              <EmojiReactionPopover
                placement="left"
                open={emojiMenuOpen()}
                onOpenChange={handleEmojiMenuOpenChange}
                onEmojiSelect={(emoji) => {
                  handleReaction(emoji);
                }}
                trigger={renderIcon(AddEmojiIcon, 'size-4')}
                triggerProps={{
                  title: 'More reactions',
                  'aria-label': 'More reactions',
                  tooltip: 'More reactions',
                  variant: 'ghost',
                  size: 'icon-sm',
                }}
              />
              <Show when={visibleActions.length > 0}>
                <div class="w-px self-stretch bg-ink/10 mx-1" />
              </Show>
            </Show>

            <For each={visibleCompose}>
              {(action) => (
                <ActionButton
                  action={action}
                  onClick={(event) => {
                    void action.onClick?.({ message: message(), event });
                  }}
                />
              )}
            </For>
            <Show when={visibleCompose.length > 0 && visibleOther.length > 0}>
              <div class="w-px self-stretch bg-ink/10 mx-1" />
            </Show>
            <For each={visibleOther}>
              {(action) => (
                <ActionButton
                  action={action}
                  onClick={(event) => {
                    void action.onClick?.({ message: message(), event });
                  }}
                />
              )}
            </For>
          </div>
        </Layer>
      </HoverActions>
    </Show>
  );
}

export function ActionMenu(props: ActionMenuProps) {
  const actionMenuVisibility = useMessageActionMenuVisibility();

  return (
    <Show when={actionMenuVisibility.visible() && !isTouchDevice()}>
      <ActionMenuContent {...props} />
    </Show>
  );
}
