import { useReactToMessage } from '@block-channel/hooks/reactions';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import clickOutside from '@core/directive/clickOutside';
import type { GetChannelResponseReactions } from '@service-comms/generated/models';
import { type Accessor, type Component, For, type Setter } from 'solid-js';
import { ReactionSelector } from '../ReactionSelector';
import type { MessageAction } from './actions';

false && clickOutside;

export type Action = {
  text: string;
  icon: Component;
  onClick: () => void;
  enabled: boolean;
};

export function ActionMenu(props: {
  messageId: string;
  channelId: Accessor<string>;
  reactions: Accessor<GetChannelResponseReactions>;
  actions: MessageAction[];
  setReactionMenuActivated?: Setter<boolean>;
}) {
  // default emojis
  const defaultEmojis = ['❤️', '👍', '😂'];

  const reactToMessage = useReactToMessage(props.channelId, props.reactions);
  const react = (emoji: string) => reactToMessage(emoji, props.messageId);
  return (
    <div class="flex flex-row bg-menu items-center allow-css-brackets">
      <For each={defaultEmojis}>
        {(emoji) => (
          <DeprecatedIconButton
            onMouseDown={() => react(emoji)}
            icon={() => <span>{emoji}</span>}
            tabIndex={-1}
          />
        )}
      </For>

      <ReactionSelector
        onEmojiClick={(emoji) => {
          react(emoji.emoji);
          props.setReactionMenuActivated?.(false);
        }}
        onOpenChange={(isOpen: boolean) => {
          props.setReactionMenuActivated?.(isOpen);
        }}
      />

      <For each={props.actions.filter((a) => a.enabled)}>
        {(a) => (
          <DeprecatedIconButton
            onMouseDown={a.onClick}
            icon={a.icon}
            tooltip={{ label: a.text, delayOverride: 0 }}
            tabIndex={-1}
          />
        )}
      </For>
    </div>
  );
}
