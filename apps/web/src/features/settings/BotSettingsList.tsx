import { BotAvatar } from '@channel/Bots/BotAvatar';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import { useBotChannelsQuery } from '@queries/bots/bots';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from './primitives';

function BotSettingsRow(props: { bot: Bot; onOpen: (botId: string) => void }) {
  const channelsQuery = useBotChannelsQuery(() => props.bot.id);
  const channels = () => channelsQuery.data ?? [];

  const channelSummary = () => {
    if (channelsQuery.isLoading) return 'Loading channels…';
    if (channels().length === 0) return 'Not in any channels yet';
    if (channels().length === 1) {
      return `In ${channels()[0]?.name ?? '1 channel'}`;
    }
    return `In ${channels().length} channels`;
  };

  return (
    <button
      type="button"
      class="flex w-full items-center gap-4 px-6 py-4 text-left outline-none hover:bg-hover focus-visible:bg-hover mobile:items-start mobile:px-4"
      onClick={() => props.onOpen(props.bot.id)}
    >
      <BotAvatar bot={props.bot} size="lg" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="truncate text-sm font-medium text-ink">
            {props.bot.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.bot.handle}
          </span>
        </div>
        <div class="mt-0.5 truncate text-xs text-ink-muted">
          {props.bot.description || channelSummary()}
        </div>
        <Show when={props.bot.description}>
          <div class="mt-1 text-xs text-ink-extra-muted">
            {channelSummary()}
          </div>
        </Show>
      </div>
      <CaretRightIcon class="size-4 shrink-0 text-ink-extra-muted" />
    </button>
  );
}

export function BotSettingsList(props: {
  bots?: Bot[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (botId: string) => void;
}) {
  return (
    <SettingsPage
      title="Bots"
      description="Create webhook-powered teammates and connect them to channels."
      actions={
        <Button variant="cta" size="sm" onClick={props.onCreate}>
          <PlusIcon />
          Create bot
        </Button>
      }
    >
      <SettingsSection
        title="Your bots"
        description="Each bot can join multiple channels. Webhook URLs are scoped to the channel."
      >
        <SettingsCard>
          <Show
            when={!props.loading}
            fallback={
              <div class="flex min-h-36 items-center justify-center">
                <LoadingSpinner class="size-10 p-2" />
              </div>
            }
          >
            <Show
              when={(props.bots?.length ?? 0) > 0}
              fallback={
                <div class="flex min-h-52 flex-col items-center justify-center px-8 text-center">
                  <div class="flex size-11 items-center justify-center rounded-xl bg-accent-bg text-accent">
                    <RobotIcon class="size-6" />
                  </div>
                  <div class="mt-3 text-sm font-medium text-ink">
                    Create your first bot
                  </div>
                  <div class="mt-1 max-w-80 text-xs text-ink-muted">
                    Bots post to channels through a secure webhook and can be
                    mentioned like any other participant.
                  </div>
                  <Button
                    class="mt-4"
                    variant="cta"
                    size="sm"
                    onClick={props.onCreate}
                  >
                    <PlusIcon />
                    Create bot
                  </Button>
                </div>
              }
            >
              <For each={props.bots}>
                {(bot) => <BotSettingsRow bot={bot} onOpen={props.onOpen} />}
              </For>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
