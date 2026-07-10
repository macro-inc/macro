import { BotCreate } from '@channel/Bots/BotCreatePage';
import { BotDetail } from '@channel/Bots/BotDetailPage';
import {
  botSettingsRequest,
  consumeBotSettingsRequest,
} from '@channel/Bots/botSettingsState';
import { useBotsQuery } from '@queries/bots/bots';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { BotSettingsList } from './BotSettingsList';

type BotSettingsView =
  | { type: 'list' }
  | { type: 'create'; initialChannelId?: string }
  | { type: 'detail'; botId: string };

export function Bots() {
  const botsQuery = useBotsQuery();
  const [view, setView] = createSignal<BotSettingsView>({ type: 'list' });
  const createView = () => {
    const current = view();
    return current.type === 'create' ? current : undefined;
  };
  const selectedBotId = () => {
    const current = view();
    return current.type === 'detail' ? current.botId : undefined;
  };

  const openCreateBot = (initialChannelId?: string) =>
    setView({ type: 'create', initialChannelId });
  const openBot = (botId: string) => setView({ type: 'detail', botId });
  const showList = () => setView({ type: 'list' });

  createEffect(
    on(botSettingsRequest, (request) => {
      if (!request) return;
      if (request.type === 'create') openCreateBot(request.initialChannelId);
      else openBot(request.botId);
      consumeBotSettingsRequest(request.id);
    })
  );

  return (
    <Show
      when={createView()}
      fallback={
        <Show
          when={selectedBotId()}
          fallback={
            <BotSettingsList
              bots={botsQuery.data}
              loading={botsQuery.isLoading}
              onCreate={() => openCreateBot()}
              onOpen={openBot}
            />
          }
        >
          {(botId) => <BotDetail botId={botId()} onBack={showList} />}
        </Show>
      }
    >
      {(create) => (
        <BotCreate channelId={create().initialChannelId} onBack={showList} />
      )}
    </Show>
  );
}
