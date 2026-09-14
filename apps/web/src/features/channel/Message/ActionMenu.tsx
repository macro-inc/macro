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
import { cn, Toolbar } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  getRenderedMessageReplyText,
  getSelectedMessageText,
} from './browser-selection';
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
  onPointerDown?: JSX.EventHandlerUnion<HTMLButtonElement, PointerEvent>;
}) {
  return (
    <Toolbar.Button
      aria-label={props.action.label}
      data-message-action={props.action.id}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
      tooltip={props.action.label}
      class={props.action.class}
    >
      {renderIcon(
        props.action.icon,
        cn(props.action.iconClass, props.action.class)
      )}
    </Toolbar.Button>
  );
}

function ActionMenuContent(props: ActionMenuProps) {
  const message = useMessage();
  const actions = useMessageActions();
  const actionMenuVisibility = useMessageActionMenuVisibility();
  const [emojiMenuOpen, setEmojiMenuOpen] = createSignal(false);
  let selectedReplyText: string | undefined;
  let renderedReplyText: string | undefined;

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
        <Toolbar size="icon-sm" onClick={(event) => event.stopPropagation()}>
          <Show when={props.showTimestamp}>
            <Timestamp format="time" class="px-1.5 whitespace-nowrap" />
            <Toolbar.Divider />
          </Show>
          <Show when={hasReactAction()}>
            <Toolbar.Group>
              <For each={QUICK_REACTION_EMOJIS}>
                {(emoji) => (
                  <Toolbar.Button
                    onClick={(event) => {
                      recordEmojiUsage(emoji);
                      handleReaction(emoji, event);
                    }}
                    aria-label={`React ${emoji}`}
                    data-message-action="react-quick"
                    data-emoji={emoji}
                  >
                    <span class="text-base my-0">{emoji}</span>
                  </Toolbar.Button>
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
                  'aria-label': 'More reactions',
                  variant: 'ghost',
                  size: 'icon-sm',
                }}
              />
            </Toolbar.Group>
            <Show when={visibleActions.length > 0}>
              <Toolbar.Divider />
            </Show>
          </Show>

          <Show when={visibleCompose.length > 0}>
            <Toolbar.Group>
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
            </Toolbar.Group>
          </Show>
          <Show when={visibleCompose.length > 0 && visibleOther.length > 0}>
            <Toolbar.Divider />
          </Show>
          <Show when={visibleOther.length > 0}>
            <Toolbar.Group>
              <For each={visibleOther}>
                {(action) => (
                  <ActionButton
                    action={action}
                    onPointerDown={(event) => {
                      if (action.id !== 'reply') return;
                      selectedReplyText = getSelectedMessageText(
                        event.currentTarget,
                        message().id
                      );
                      renderedReplyText = getRenderedMessageReplyText(
                        event.currentTarget,
                        message().id
                      );
                    }}
                    onClick={(event) => {
                      const selectedText =
                        action.id === 'reply'
                          ? (selectedReplyText ??
                            getSelectedMessageText(
                              event.currentTarget,
                              message().id
                            ))
                          : undefined;
                      selectedReplyText = undefined;
                      const renderedText =
                        action.id === 'reply'
                          ? (renderedReplyText ??
                            getRenderedMessageReplyText(
                              event.currentTarget,
                              message().id
                            ))
                          : undefined;
                      renderedReplyText = undefined;
                      void action.onClick?.({
                        message: message(),
                        event,
                        selectedText,
                        renderedText,
                      });
                    }}
                  />
                )}
              </For>
            </Toolbar.Group>
          </Show>
        </Toolbar>
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
