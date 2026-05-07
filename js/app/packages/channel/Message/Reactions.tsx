import { useUserId } from '@core/context/user';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show } from 'solid-js';
import { EmojiReactionPopover } from './EmojiReactionPopover';
import { useMessage, useMessageActions } from './context';
import { ReactionChip } from './ReactionChip';
import { renderIcon } from './render-icon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import AddEmojiIcon from '@macro-icons/square/add-emoji.svg';

type ReactionsProps = {
  class?: string;
};

export function Reactions(props: ReactionsProps) {
  const message = useMessage();
  const actions = useMessageActions();
  const userId = useUserId();
  const [emojiMenuOpen, setEmojiMenuOpen] = createSignal(false);

  const canReact = () => actions?.onReact !== undefined;

  return (
    <Show when={message().reactions.length > 0}>
      <div
        class={cn(
          'flex flex-row flex-wrap items-center gap-1 mt-0.5 mb-1',
          props.class
        )}
        data-message-reactions-row
      >
        <For each={message().reactions}>
          {(reaction) => {
            const didCurrentUserReact = () =>
              !!userId() && reaction.users.includes(userId()!);

            return (
              <ReactionChip
                emoji={reaction.emoji}
                count={reaction.users.length}
                users={reaction.users}
                currentUserId={userId() ?? undefined}
                selected={didCurrentUserReact()}
                interactive={canReact()}
                onClick={(event) => {
                  void actions?.onReact?.({
                    message: message(),
                    event,
                    emoji: reaction.emoji,
                  });
                }}
              />
            );
          }}
        </For>

        <Show when={canReact() && !isTouchDevice()}>
          <EmojiReactionPopover
            placement="top"
            open={emojiMenuOpen()}
            onOpenChange={setEmojiMenuOpen}
            onEmojiSelect={(emoji) => {
              void actions?.onReact?.({
                message: message(),
                emoji,
              });
            }}
            trigger={renderIcon(AddEmojiIcon, 'size-4')}
            triggerProps={{
              variant: 'base',
              size: 'icon-sm',
              'aria-label': 'Add reaction',
              class:
                'border border-edge-muted flex items-center justify-center text-ink-muted hover:bg-hover',
              onClick: (e: MouseEvent) => e.stopPropagation(),
            }}
          />
        </Show>
      </div>
    </Show>
  );
}
