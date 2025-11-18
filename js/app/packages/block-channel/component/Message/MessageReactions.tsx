import {
  messageToReactionStore,
  reactToMessage,
} from '@block-channel/signal/reactions';
import { EmojiButton } from '@core/component/Emoji/EmojiButton';
import { resolveEmojiFromUnicode } from '@core/component/Emoji/emojis';
import clickOutside from '@core/directive/clickOutside';
import { touchHandler } from '@core/directive/touchHandler';
import { idToDisplayName } from '@core/user';
import Tooltip from '@corvu/tooltip';

import { useUserId } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ReactionSelector } from '../ReactionSelector';

false && clickOutside;
false && touchHandler;

type MessageReactionsProps = {
  messageId: string;
};

export function MessageReactions(props: MessageReactionsProps) {
  const userId = useUserId();

  const messageToReaction = messageToReactionStore.get;

  const reactionsForMessage = () => {
    return messageToReaction?.[props.messageId];
  };

  const react = createCallback((emoji: string) =>
    reactToMessage(emoji, props.messageId)
  );

  return (
    <Show when={reactionsForMessage() && reactionsForMessage().length > 0}>
      <div class="flex flex-row flex-wrap items-center gap-2 mt-0.5 mb-1">
        <For each={reactionsForMessage().slice(0, 10)}>
          {(reaction) => {
            const didCurrentUserReact = !userId()
              ? false
              : reaction.users.includes(userId()!);

            const tooltipContent = createMemo(() => {
              let users = reaction.users.map((userId_) => {
                if (userId_ === userId()!) {
                  return 'You';
                }
                return idToDisplayName(userId_);
              });

              if (users.length === 1) {
                return idToDisplayName(users[0]);
              }
              const first = users.slice(0, -1);
              const lastUser = users.slice(-1)[0];
              // Team oxford comma
              return first.join(', ') + ', and ' + lastUser;
            });

            const [isOpen, setIsOpen] = createSignal(false);

            return (
              <Tooltip group="channel" open={isOpen()} onOpenChange={setIsOpen}>
                <Tooltip.Trigger as="div">
                  <div
                    class={`flex flex-row items-center gap-2 py-1 px-2 bg-menu
                          ${
                            didCurrentUserReact
                              ? 'text-accent-ink border border-accent'
                              : 'hover:bg-hover transition-transform border border-edge-muted transition-none hover:transition hover:scale-105'
                          } 
                          cursor-default h-8
                        `}
                    onClick={() => react(reaction.emoji)}
                    use:touchHandler={{
                      onLongPress: (e) => {
                        e.preventDefault();
                        setIsOpen(true);
                      },
                      onShortTouch: (e) => {
                        e.preventDefault();
                        react(reaction.emoji);
                      },
                    }}
                    use:clickOutside={() => setIsOpen(false)}
                  >
                    <EmojiButton
                      emoji={resolveEmojiFromUnicode(reaction.emoji)!}
                      size="sm"
                    />
                    {reaction.users.length > 1 ? reaction.users.length : ''}
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content class="mt-3 z-tool-tip">
                    <Tooltip.Arrow class="text-ink text-xs w-1 h-1" />
                    <div class="flex flex-col gap-1 bg-ink rounded-md p-2 max-w-[220px]">
                      <p class="text-xs text-panel font-semibold">
                        {tooltipContent()}{' '}
                        <span class="text-edge font-medium">
                          reacted with{' '}
                          <span class="text-md">{reaction.emoji}</span>
                        </span>
                      </p>
                    </div>
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip>
            );
          }}
        </For>
        <ReactionSelector onEmojiClick={(emoji) => react(emoji.emoji)} />
      </div>
    </Show>
  );
}
