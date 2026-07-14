import { channelWebhookUrl } from '@channel/Bots/webhook';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import {
  useChannelBotsQuery,
  useRemoveBotFromChannelMutation,
} from '@queries/channel/channel-bots';
import { Button, Panel } from '@ui';
import { For, Show } from 'solid-js';
import { BotInviteSelect } from '../Bots/BotInviteSelect';
import { ChannelBotRow } from './ChannelBotRow';

export function ChannelBotsPanel(props: {
  channelId: string;
  editable: boolean;
  inviteFocusRequest: number;
  onCreateBot: () => void;
  onOpenBot: (botId: string) => void;
}) {
  const botsQuery = useChannelBotsQuery(() => props.channelId);
  const removeBotMutation = useRemoveBotFromChannelMutation();
  const bots = () => botsQuery.data ?? [];

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(channelWebhookUrl(props.channelId));
      toast.success('Webhook URL copied');
    } catch {
      toast.failure('Failed to copy webhook URL');
    }
  };

  const removeBot = (botId: string, name: string) => {
    removeBotMutation.mutate(
      { channelId: props.channelId, botId },
      {
        onSuccess: () => toast.success(`${name} removed from channel`),
        onError: () => toast.failure('Failed to remove bot'),
      }
    );
  };

  return (
    <Panel
      depth={2}
      class="h-[min(42%,22rem)] min-h-52 shrink-0 overflow-hidden text-ink"
    >
      <Panel.Header class="h-auto min-h-10 justify-between gap-3 px-6 py-2">
        <div>
          <div class="text-sm font-semibold">Bots</div>
          <div class="text-xs font-normal text-ink-muted">
            Webhook-powered channel participants
          </div>
        </div>
        <Show when={props.editable}>
          <Button variant="cta" size="sm" onClick={props.onCreateBot}>
            <PlusIcon />
            New bot
          </Button>
        </Show>
      </Panel.Header>
      <Panel.Body>
        <div class="flex h-full flex-col">
          <Show when={props.editable}>
            <div class="shrink-0 border-b border-edge-muted px-6 py-3">
              <BotInviteSelect
                channelId={props.channelId}
                channelBotIds={bots().map((bot) => bot.id)}
                focusRequest={props.inviteFocusRequest}
              />
            </div>
          </Show>
          <Show
            when={!botsQuery.isLoading}
            fallback={
              <div class="flex min-h-0 flex-1 items-center justify-center">
                <LoadingSpinner class="size-9 p-2" />
              </div>
            }
          >
            <Show
              when={bots().length > 0}
              fallback={
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                  <div class="flex size-9 items-center justify-center rounded-lg bg-accent-bg text-accent">
                    <RobotIcon class="size-5" />
                  </div>
                  <div class="mt-2 text-sm font-medium">
                    No bots in this channel
                  </div>
                  <div class="mt-0.5 text-xs text-ink-muted">
                    Select an existing bot above or create a new one.
                  </div>
                </div>
              }
            >
              <div class="min-h-0 flex-1 overflow-y-auto">
                <For each={bots()}>
                  {(bot) => (
                    <ChannelBotRow
                      bot={bot}
                      editable={props.editable}
                      removing={removeBotMutation.isPending}
                      onOpen={() => props.onOpenBot(bot.id)}
                      onCopyWebhook={() => void copyWebhook()}
                      onRemove={() => removeBot(bot.id, bot.name)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Panel.Body>
    </Panel>
  );
}
