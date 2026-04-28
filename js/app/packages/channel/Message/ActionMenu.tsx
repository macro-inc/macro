import ReplyIcon from '@macro-icons/square/reply.svg';
import LinkIcon from '@macro-icons/square/link.svg';
import EditIcon from '@macro-icons/square/edit.svg';
import AddEmojiIcon from '@macro-icons/square/add-emoji.svg';
import TrashIcon from '@macro-icons/square/trash.svg';
import StarIcon from '@macro-icons/wide/star.svg';
import TaskIcon from '@macro-icons/wide/task.svg';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show, type Component, type JSX } from 'solid-js';
import { useMessage, useMessageActions } from './context';
import { EmojiReactionPopover } from './EmojiReactionPopover';
import { HoverActions } from './HoverActions';
import { renderIcon } from './render-icon';
import type { MessageActionEvent, MessageActionHandler } from './types';

const QUICK_REACTION_EMOJIS = ['❤️', '👍', '😂'] as const;

type ActionId =
  | 'reply'
  | 'copy-link'
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
};

type ActionMenuProps = {
  class?: string;
};

function ActionButton(props: {
  action: ActionItem;
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}) {
  return (
    <button
      type="button"
      title={props.action.label}
      aria-label={props.action.label}
      data-message-action={props.action.id}
      class={cn(
        'h-8 px-2 flex items-center justify-center text-ink hover:bg-hover hover-transition-bg',
        props.action.class
      )}
      onClick={props.onClick}
    >
      <span class="block size-5">
        {renderIcon(props.action.icon, 'w-full h-full')}
      </span>
    </button>
  );
}

export function ActionMenu(props: ActionMenuProps) {
  const message = useMessage();
  const actions = useMessageActions();
  const [emojiMenuOpen, setEmojiMenuOpen] = createSignal(false);

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
      class: 'px-1.5',
    },
    {
      id: 'copy-link',
      label: 'Copy Link',
      icon: LinkIcon,
      onClick: actions?.onCopyLink,
      class: 'px-1.5',
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: EditIcon,
      onClick: actions?.onEdit,
      class: 'px-1.5',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      onClick: actions?.onDelete,
      destructive: true,
      class: 'px-1.5 text-failure-ink',
    },
  ];

  const visibleCompose = composeActions.filter((item) => item.onClick);
  const visibleOther = otherActions.filter((item) => item.onClick);
  const visibleActions = [...visibleCompose, ...visibleOther];

  return (
    <Show when={hasReactAction() || visibleActions.length > 0}>
      <HoverActions class={props.class} persistentVisible={emojiMenuOpen()}>
        <div
          class="flex flex-row bg-menu border border-edge-muted items-center allow-css-brackets -space-x-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={hasReactAction()}>
            <For each={QUICK_REACTION_EMOJIS}>
              {(emoji) => (
                <button
                  type="button"
                  title={`React ${emoji}`}
                  aria-label={`React ${emoji}`}
                  data-message-action="react-quick"
                  data-emoji={emoji}
                  class="size-8 flex items-center justify-center hover:bg-hover hover-transition-bg text-lg/none"
                  onClick={(event) => {
                    handleReaction(emoji, event);
                  }}
                >
                  {emoji}
                </button>
              )}
            </For>

            <EmojiReactionPopover
              placement="left"
              open={emojiMenuOpen()}
              onOpenChange={setEmojiMenuOpen}
              onEmojiSelect={(emoji) => {
                handleReaction(emoji);
              }}
              trigger={renderIcon(AddEmojiIcon)}
              triggerProps={{
                title: 'More reactions',
                'aria-label': 'More reactions',
                'data-message-action': 'react-open-menu',
                class:
                  'size-8 flex items-center justify-center text-ink-muted hover:bg-hover hover-transition-bg',
              }}
            />
            <Show when={visibleActions.length > 0}>
              <div class="w-px self-stretch bg-edge-muted mx-1" />
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
            <div class="w-px self-stretch bg-edge-muted mx-1" />
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
      </HoverActions>
    </Show>
  );
}
