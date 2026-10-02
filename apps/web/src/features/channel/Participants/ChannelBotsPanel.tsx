import { channelWebhookUrl } from '@channel/Bots/webhook';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import {
  useChannelBotsQuery,
  useRemoveBotFromChannelMutation,
} from '@queries/channel/channel-bots';
import { Button, Card, Item } from '@ui';
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
    <Card>
      <Card.Header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Card.Title>Bots</Card.Title>
          <Show when={props.editable}>
            <Button variant="outline" onClick={props.onCreateBot}>
              <PlusIcon />
              New bot
            </Button>
          </Show>
        </div>
        <Card.Description>
          Webhook-powered channel participants
        </Card.Description>
      </Card.Header>
      <Card.Body>
        <div class="flex flex-col gap-3">
          <Show when={props.editable}>
            <BotInviteSelect
              channelId={props.channelId}
              channelBotIds={bots().map((bot) => bot.id)}
              focusRequest={props.inviteFocusRequest}
            />
          </Show>
          <Show when={!botsQuery.isLoading} fallback={<LoadingSpinner />}>
            <Show
              when={bots().length > 0}
              fallback={
                <Item role="status">
                  <Item.Media>
                    <RobotIcon />
                  </Item.Media>
                  <Item.Content>
                    <Item.Title>No bots in this channel</Item.Title>
                    <Show when={props.editable}>
                      <Item.Description>
                        Select an existing bot above or create a new one.
                      </Item.Description>
                    </Show>
                  </Item.Content>
                </Item>
              }
            >
              <div>
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
      </Card.Body>
    </Card>
  );
}
