import KeyIcon from '@phosphor/key.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { BotFormSection } from './BotFormSection';
import { CredentialField } from './CredentialField';
import { channelWebhookUrl } from './webhook';

type BotWebhookChannel = {
  id: string;
  name: string;
};

type BotWebhooksSectionProps = {
  channels: BotWebhookChannel[];
  onNewToken: () => void;
};

export function BotWebhooksSection(props: BotWebhooksSectionProps) {
  return (
    <BotFormSection
      title="Webhooks"
      description="Copy a channel URL or generate another token."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onNewToken}
        >
          <KeyIcon />
          New token
        </Button>
      }
    >
      <Show
        when={props.channels.length > 0}
        fallback={
          <p class="text-xs text-ink-muted">
            Add this bot to a channel to get a webhook URL.
          </p>
        }
      >
        <div class="flex flex-col gap-4">
          <For each={props.channels}>
            {(channel) => (
              <CredentialField
                label={channel.name}
                value={channelWebhookUrl(channel.id)}
                help="Webhook URL"
              />
            )}
          </For>
        </div>
      </Show>
    </BotFormSection>
  );
}
