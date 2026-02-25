import { useReactToMessage } from '@block-channel/hooks/reactions';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import clickOutside from '@core/directive/clickOutside';
import type { GetChannelResponseReactions } from '@service-comms/generated/models';
import { Popover } from '@kobalte/core/popover';
import SmileIcon from '@phosphor-icons/core/regular/smiley.svg?component-solid';
import {
  type Accessor,
  type Component,
  createSignal,
  For,
  type Setter,
} from 'solid-js';
import { EmojiSearchSelector } from '../ReactionSelector';
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

  const [openEmojiPopover, setOpenEmojiPopover] = createSignal(false);

  const reactToMessage = useReactToMessage(props.channelId, props.reactions);
  const react = (emoji: string) => reactToMessage(emoji, props.messageId);

  const handleOpenChange = (isOpen: boolean) => {
    setOpenEmojiPopover(isOpen);
    props.setReactionMenuActivated?.(isOpen);
  };

  const handleClose = () => {
    setOpenEmojiPopover(false);
    props.setReactionMenuActivated?.(false);
  };

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

      <Popover
        placement="left"
        onOpenChange={handleOpenChange}
        open={openEmojiPopover()}
        overflowPadding={8}
        slide={true}
      >
        <Popover.Trigger tabIndex={-1}>
          <DeprecatedIconButton icon={SmileIcon} tabIndex={-1} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-modal">
            <Popover.Arrow class="fill-menu" />
            <EmojiSearchSelector
              onEmojiClick={(emoji) => {
                react(emoji.emoji);
                handleClose();
              }}
              handleClose={handleClose}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover>

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
