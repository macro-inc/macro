import { useUserId } from '@core/context/user';
import PlusIcon from '@icon/regular/plus.svg';
import { cn } from '@ui/utils/classname';
import { createSignal, For, Show } from 'solid-js';
import { EmojiReactionPopover } from './EmojiReactionPopover';
import { useMessage, useMessageActions } from './context';
import { ReactionChip } from './ReactionChip';
import { renderIcon } from './render-icon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

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
          'flex flex-row flex-wrap items-center gap-2 mt-0.5 mb-1',
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
            trigger={renderIcon(PlusIcon)}
            triggerProps={{
              'aria-label': 'Add reaction',
              'data-message-reaction-add': '',
              class:
                'h-8 w-8 border border-edge-muted bg-menu flex items-center justify-center text-ink-muted hover:bg-hover hover-transition-bg',
            }}
          />
        </Show>
      </div>
    </Show>
  );
}
