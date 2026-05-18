import AddEmojiIcon from '@icon/square-add-emoji.svg';
import EditIcon from '@icon/square-edit.svg';
import LinkIcon from '@icon/square-link.svg';
import ReplyIcon from '@icon/square-reply.svg';
import TrashIcon from '@icon/square-trash.svg';
import StarIcon from '@icon/wide-star.svg';
import TaskIcon from '@icon/wide-task.svg';
import { Button, Layer } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
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
    <Button
      aria-label={props.action.label}
      data-message-action={props.action.id}
      onClick={props.onClick}
      tooltip={props.action.label}
      size="icon-sm"
      variant="ghost"
      class={props.action.class}
    >
      {renderIcon(props.action.icon, props.action.class)}
    </Button>
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
    },
    {
      id: 'copy-link',
      label: 'Copy Link',
      icon: LinkIcon,
      onClick: actions?.onCopyLink,
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: EditIcon,
      onClick: actions?.onEdit,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      onClick: actions?.onDelete,
      destructive: true,
      class: 'text-failure-ink',
    },
  ];

  const visibleCompose = composeActions.filter((item) => item.onClick);
  const visibleOther = otherActions.filter((item) => item.onClick);
  const visibleActions = [...visibleCompose, ...visibleOther];

  return (
    <Show when={hasReactAction() || visibleActions.length > 0}>
      <HoverActions class={props.class} persistentVisible={emojiMenuOpen()}>
        <Layer depth={2}>
          <div
            class="flex flex-row bg-surface ring ring-edge p-1 shadow items-center rounded-md"
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={hasReactAction()}>
              <For each={QUICK_REACTION_EMOJIS}>
                {(emoji) => (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={(event) => {
                      handleReaction(emoji, event);
                    }}
                    tooltip={`React ${emoji}`}
                    aria-label={`React ${emoji}`}
                    data-message-action="react-quick"
                    data-emoji={emoji}
                  >
                    <span class="text-md my-0">{emoji}</span>
                  </Button>
                )}
              </For>

              <EmojiReactionPopover
                placement="left"
                open={emojiMenuOpen()}
                onOpenChange={setEmojiMenuOpen}
                onEmojiSelect={(emoji) => {
                  handleReaction(emoji);
                }}
                trigger={renderIcon(AddEmojiIcon, 'size-3')}
                triggerProps={{
                  title: 'More reactions',
                  'aria-label': 'More reactions',
                  tooltip: 'More reactions',
                  variant: 'ghost',
                  size: 'icon-sm',
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
        </Layer>
      </HoverActions>
    </Show>
  );
}
