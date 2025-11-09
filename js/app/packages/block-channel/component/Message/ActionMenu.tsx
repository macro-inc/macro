import { reactToMessage } from '@block-channel/signal/reactions';
import { IconButton } from '@core/component/IconButton';
import clickOutside from '@core/directive/clickOutside';
import { createCallback } from '@solid-primitives/rootless';
import { type Component, For, type Setter } from 'solid-js';
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
  actions: MessageAction[];
  setReactionMenuActivated?: Setter<boolean>;
}) {
  // default emojis
  const defaultEmojis = ['❤️', '👍', '😂'];

  const react = createCallback((emoji: string) =>
    reactToMessage(emoji, props.messageId)
  );
  return (
    <div class="flex flex-row bg-menu items-center allow-css-brackets">
      <For each={defaultEmojis}>
        {(emoji) => (
          <IconButton
            onMouseDown={() => react(emoji)}
            icon={() => <span>{emoji}</span>}
            tabIndex={0}
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
          <IconButton
            onMouseDown={a.onClick}
            icon={a.icon}
            tooltip={{ label: a.text, delayOverride: 0 }}
            tabIndex={0}
          />
        )}
      </For>
    </div>
  );
}
