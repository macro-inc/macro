import { BotAvatar } from '@channel/Bots/BotAvatar';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import CopyIcon from '@phosphor/copy.svg';
import XIcon from '@phosphor/x.svg';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Badge, Button, Item } from '@ui';
import { Show } from 'solid-js';

export function ChannelBotRow(props: {
  bot: Bot;
  editable: boolean;
  removing: boolean;
  onOpen: () => void;
  onCopyWebhook: () => void;
  onRemove: () => void;
}) {
  const description = () =>
    [`@${props.bot.handle}`, props.bot.description].filter(Boolean).join(' · ');
  const navigationHandlers = useSplitNavigationHandler<HTMLAnchorElement>(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      props.onOpen();
    }
  );

  return (
    <div class="relative">
      <a
        {...navigationHandlers}
        role="link"
        tabIndex={0}
        aria-label={`Open ${props.bot.name}`}
        class="block rounded-xl hover:bg-hover focus-visible:outline-2 focus-visible:outline-edge"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          event.currentTarget.click();
        }}
      >
        <Item class={props.editable ? 'pr-20' : 'pr-12'}>
          <BotAvatar bot={props.bot} size="lg" />
          <Item.Content>
            <Item.Title class="truncate">{props.bot.name}</Item.Title>
            <Item.Description class="truncate">
              {description()}
            </Item.Description>
          </Item.Content>
          <Item.Actions>
            <Badge variant="outline" size="sm">
              Bot
            </Badge>
          </Item.Actions>
        </Item>
      </a>
      <div class="absolute right-3 top-1/2 -translate-y-1/2">
        <Item.Actions>
          <Button
            size="icon-sm"
            label="Copy webhook URL"
            onClick={props.onCopyWebhook}
          >
            <CopyIcon />
          </Button>
          <Show when={props.editable}>
            <Button
              size="icon-sm"
              label={`Remove ${props.bot.name}`}
              disabled={props.removing}
              onClick={props.onRemove}
            >
              <XIcon />
            </Button>
          </Show>
        </Item.Actions>
      </div>
    </div>
  );
}
