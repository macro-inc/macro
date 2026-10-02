import { BotAvatar } from '@channel/Bots/BotAvatar';
import CopyIcon from '@phosphor/copy.svg';
import XIcon from '@phosphor/x.svg';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button, Item } from '@ui';
import { Show } from 'solid-js';

export function ChannelBotRow(props: {
  bot: Bot;
  editable: boolean;
  removing: boolean;
  onOpen: () => void;
  onCopyWebhook: () => void;
  onRemove: () => void;
}) {
  return (
    <Item>
      <BotAvatar bot={props.bot} size="lg" />
      <Item.Content>
        <Item.Title>
          <Button onClick={props.onOpen} label={`Open ${props.bot.name}`}>
            {props.bot.name}
          </Button>
        </Item.Title>
        <Item.Metadata>@{props.bot.handle}</Item.Metadata>
        <Show when={props.bot.description}>
          <Item.Description>{props.bot.description}</Item.Description>
        </Show>
      </Item.Content>
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
    </Item>
  );
}
