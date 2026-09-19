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
    <div class="group relative flex items-center gap-3 border-b border-edge-muted px-6 py-2.5 last:border-b-0 hover:bg-hover focus-within:bg-hover">
      <button
        type="button"
        class="absolute inset-0 z-0 rounded-md outline-none"
        aria-label={`Open ${props.bot.name}`}
        onClick={props.onOpen}
      />
      <div class="pointer-events-none relative z-1">
        <BotAvatar bot={props.bot} size="lg" />
      </div>
      <div class="pointer-events-none relative z-1 min-w-0 flex-1">
        <div class="flex min-w-0 items-baseline gap-1.5">
          <span class="truncate text-sm font-medium">{props.bot.name}</span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.bot.handle}
          </span>
        </div>
        <Show when={props.bot.description}>
          {(description) => (
            <div class="mt-0.5 truncate text-xs text-ink-muted">
              {description()}
            </div>
          )}
        </Show>
      </div>
      <Button
        class="relative z-1"
        variant="outline"
        size="sm"
        label="Copy webhook URL"
        onClick={props.onCopyWebhook}
      >
        <CopyIcon />
        Webhook URL
      </Button>
      <Show when={props.editable}>
        <Button
          class="relative z-1"
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
