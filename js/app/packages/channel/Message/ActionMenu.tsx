import ReplyIcon from '@icon/regular/arrow-bend-up-left.svg';
import LinkIcon from '@icon/regular/link.svg';
import PencilIcon from '@icon/regular/pencil.svg';
import PlusIcon from '@icon/regular/plus.svg';
import TrashIcon from '@icon/regular/trash.svg';
import { EmojiSelector } from '@core/component/Emoji/EmojiSelector';
import { Popover } from '@kobalte/core/popover';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show, type Component, type JSX } from 'solid-js';
import { HoverActions } from './HoverActions';
import { useMessage, useMessageActions } from './context';
import type { MessageActionEvent, MessageActionHandler } from './types';

const QUICK_REACTION_EMOJIS = ['❤️', '👍', '😂'] as const;

type ActionId = 'reply' | 'copy-link' | 'edit' | 'delete';

type ActionItem = {
  id: ActionId;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string;
  onClick?: MessageActionHandler;
  destructive?: boolean;
};

type ActionMenuProps = {
  class?: string;
};

function renderIcon(
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string
): JSX.Element {
  if (typeof icon === 'string') {
    return <img src={icon} alt="" class="size-4" />;
  }

  const Icon = icon;
  return <Icon class="size-4" />;
}

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
        'size-8 flex items-center justify-center text-ink-muted hover:bg-hover hover-transition-bg',
        {
          'text-failure-ink': props.action.destructive,
        }
      )}
      onClick={props.onClick}
    >
      {renderIcon(props.action.icon)}
    </button>
  );
}

function EmojiSearchMenu(props: {
  onEmojiClick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal('');

  return (
    <div
      class="w-[258px] h-[315px] pl-2 pt-2 rounded-md flex flex-col bg-menu shadow-lg border border-edge-muted"
      role="dialog"
      aria-label="Emoji search"
    >
      <div class="flex pr-2 w-full">
        <div class="flex flex-row items-center text-ink gap-1 border border-edge-muted rounded-md px-2 py-1 text-xs w-full">
          <input
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              props.onClose();
            }}
            placeholder="Search emojis"
            role="searchbox"
            aria-label="Search emojis"
          />
        </div>
      </div>
      <div class="flex-grow overflow-y-auto overflow-x-hidden mt-2">
        <EmojiSelector
          nameFilter={query()}
          onEmojiClick={(emoji) => {
            props.onEmojiClick(emoji.emoji);
            props.onClose();
          }}
        />
      </div>
    </div>
  );
}

export function ActionMenu(props: ActionMenuProps) {
  const message = useMessage();
  const actions = useMessageActions();
  const [emojiMenuOpen, setEmojiMenuOpen] = createSignal(false);

  const handleReaction = (emoji: string, event?: MessageActionEvent) => {
    void actions?.onReact?.({
      message,
      event,
      emoji,
    });
  };

  const hasReactAction = () => actions?.onReact !== undefined;

  const actionItems: ActionItem[] = [
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
      icon: PencilIcon,
      onClick: actions?.onEdit,
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: TrashIcon,
      onClick: actions?.onDelete,
      destructive: true,
    },
  ];

  const visibleActions = actionItems.filter((item) => item.onClick);

  return (
    <Show when={hasReactAction() || visibleActions.length > 0}>
      <HoverActions class={props.class}>
        <div class="flex flex-row bg-menu border border-edge-muted items-center allow-css-brackets">
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

            <Popover
              placement="left"
              onOpenChange={setEmojiMenuOpen}
              open={emojiMenuOpen()}
              overflowPadding={8}
              slide={true}
            >
              <Popover.Trigger
                type="button"
                title="More reactions"
                aria-label="More reactions"
                data-message-action="react-open-menu"
                class="size-8 flex items-center justify-center text-ink-muted hover:bg-hover hover-transition-bg"
              >
                {renderIcon(PlusIcon)}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content class="z-modal">
                  <Popover.Arrow class="fill-menu" />
                  <EmojiSearchMenu
                    onEmojiClick={(emoji) => {
                      handleReaction(emoji);
                    }}
                    onClose={() => setEmojiMenuOpen(false)}
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover>
          </Show>

          <For each={visibleActions}>
            {(action) => (
              <ActionButton
                action={action}
                onClick={(event) => {
                  void action.onClick?.({ message, event });
                }}
              />
            )}
          </For>
        </div>
      </HoverActions>
    </Show>
  );
}
