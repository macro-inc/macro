import { channelWebhookUrl } from '@channel/Bots/webhook';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import {
  useChannelBotsQuery,
  useRemoveBotFromChannelMutation,
} from '@queries/channel/channel-bots';
import { Button, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { BotInviteSelect } from '../Bots/BotInviteSelect';
import { ChannelBotRow } from './ChannelBotRow';
import { ParticipantsActionSheet } from './ParticipantsActionSheet';
import { ParticipantsSearchInput } from './ParticipantsSearchInput';

export function ChannelBotsPanel(props: {
  channelId: string;
  editable: boolean;
  inviteFocusRequest: number;
  onCreateBot: () => void;
  onOpenBot: (botId: string) => void;
}) {
  const botsQuery = useChannelBotsQuery(() => props.channelId);
  const removeBotMutation = useRemoveBotFromChannelMutation();
  const bots = () => (botsQuery.isSuccess ? botsQuery.data : []) ?? [];
  const [search, setSearch] = createSignal('');
  const filteredBots = () => {
    const query = search().trim().toLowerCase();
    return bots().filter((bot) =>
      `${bot.name} ${bot.handle} ${bot.description ?? ''}`
        .toLowerCase()
        .includes(query)
    );
  };

  const [inviteState, setInviteState] = createSignal({
    open: props.inviteFocusRequest > 0,
    request: props.inviteFocusRequest,
  });
  const inviteOpen = () =>
    inviteState().open ||
    (props.inviteFocusRequest > 0 &&
      props.inviteFocusRequest !== inviteState().request);
  const setInviteOpen = (open: boolean) =>
    setInviteState({ open, request: props.inviteFocusRequest });
  const inviteForm = () => (
    <BotInviteSelect
      channelId={props.channelId}
      channelBotIds={bots().map((bot) => bot.id)}
      focusRequest={isTouchDevice() ? 0 : props.inviteFocusRequest}
      onInvited={isTouchDevice() ? () => setInviteOpen(false) : undefined}
    />
  );

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

  const list = () => (
    <Show
      when={!botsQuery.isLoading}
      fallback={
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <LoadingSpinner class="size-9 p-2" />
        </div>
      }
    >
      <Show
        when={filteredBots().length > 0}
        fallback={
          <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <div class="flex size-9 items-center justify-center rounded-lg bg-hover text-ink-muted">
              <RobotIcon class="size-5" />
            </div>
            <div class="mt-2 text-sm font-medium">
              {search().trim() ? 'No matching bots' : 'No bots in this channel'}
            </div>
            <div class="mt-0.5 text-xs text-ink-muted">
              {search().trim()
                ? 'Try a different name or handle.'
                : 'Invite an existing bot or create a new one.'}
            </div>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto">
          <For each={filteredBots()}>
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
  );

  return (
    <>
      <Show
        when={isTouchDevice()}
        fallback={
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
                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={props.onCreateBot}>
                    <PlusIcon />
                    New bot
                  </Button>
                </div>
              </Show>
            </Panel.Header>
            <Panel.Body>
              <div class="flex h-full flex-col">
                <Show when={props.editable && !isTouchDevice()}>
                  <div class="shrink-0 border-b border-edge-muted px-6 py-3">
                    {inviteForm()}
                  </div>
                </Show>
                {list()}
              </div>
            </Panel.Body>
          </Panel>
        }
      >
        <div class="flex shrink-0 items-center gap-2">
          <div class="min-w-0 flex-1">
            <ParticipantsSearchInput
              value={search()}
              onInput={setSearch}
              placeholder="Search bots"
            />
          </div>
          <Show when={props.editable}>
            <Button
              variant="outline"
              size="icon-md"
              label="New bot"
              onClick={props.onCreateBot}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-md"
              label="Invite bot"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlusIcon />
            </Button>
          </Show>
        </div>
        <div class="flex min-h-0 flex-1 flex-col">{list()}</div>
      </Show>
      <Show when={props.editable && isTouchDevice()}>
        <ParticipantsActionSheet
          title="Invite bot"
          open={inviteOpen()}
          onOpenChange={setInviteOpen}
        >
          {inviteForm()}
        </ParticipantsActionSheet>
      </Show>
    </>
  );
}
