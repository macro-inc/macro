import { createSignal } from 'solid-js';

export type BotSettingsRequest =
  | { id: number; type: 'create'; initialChannelId?: string }
  | { id: number; type: 'detail'; botId: string };

const [botSettingsRequest, setBotSettingsRequest] =
  createSignal<BotSettingsRequest>();
let nextRequestId = 0;

export { botSettingsRequest };

export function requestBotCreation(initialChannelId?: string) {
  setBotSettingsRequest({
    id: ++nextRequestId,
    type: 'create',
    initialChannelId,
  });
}

export function requestBotDetail(botId: string) {
  setBotSettingsRequest({ id: ++nextRequestId, type: 'detail', botId });
}

export function consumeBotSettingsRequest(id: number) {
  if (botSettingsRequest()?.id === id) setBotSettingsRequest(undefined);
}
