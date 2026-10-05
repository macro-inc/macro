import { BotAvatar } from '@channel/Bots/BotAvatar';
import CopyIcon from '@phosphor/copy.svg';
import XIcon from '@phosphor/x.svg';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button } from '@ui';
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
    <div class="flex w-full items-center justify-between gap-2 border-b border-edge-muted px-6 py-2 text-sm last:border-b-0 not-touch:hover:bg-hover">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-3 rounded-xs text-left focus:outline-none"
        aria-label={`Open ${props.bot.name}`}
        onClick={props.onOpen}
      >
        <div class="shrink-0">
          <BotAvatar bot={props.bot} size="lg" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-ink">
            {props.bot.name}
          </div>
          <div class="truncate text-xs text-ink-muted">
            @{props.bot.handle}
            <Show when={props.bot.description}>
              {' · '}
              {props.bot.description}
            </Show>
          </div>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Copy webhook URL"
        onClick={props.onCopyWebhook}
      >
        <CopyIcon />
      </Button>
      <Show when={props.editable}>
        <Button
          variant="ghost"
          size="icon-sm"
          label={`Remove ${props.bot.name}`}
          aria-label={`Remove ${props.bot.name}`}
          disabled={props.removing}
          onClick={props.onRemove}
        >
          <XIcon />
        </Button>
      </Show>
    </div>
  );
}
