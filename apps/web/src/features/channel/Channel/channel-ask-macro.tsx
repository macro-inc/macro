import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useChannelName, useChannelType } from '@core/context/channels';
import { type Accessor, Show } from 'solid-js';

/**
 * Seed for "Ask Macro": a new chat with this channel @mentioned, so the user
 * does not have to create an agent and mention the channel by hand.
 * `fallbackName` names a channel the channels list has not loaded yet.
 */
export function useChannelAskMacroEntity(
  channelId: string,
  fallbackName?: Accessor<string | undefined>
) {
  const channelName = useChannelName(channelId);
  const channelType = useChannelType(channelId);
  return () => {
    const type = channelType();
    if (!type) return undefined;
    return {
      type: 'channel' as const,
      id: channelId,
      name: channelName() ?? fallbackName?.() ?? 'New Channel',
      channelType: type,
    };
  };
}

/**
 * The desktop channel header's Ask Macro button: the same button a document
 * header shows before Share, here before Invite.
 */
export function ChannelAskMacroButton(props: {
  channelId: string;
  fallbackName?: string;
}) {
  const entity = useChannelAskMacroEntity(
    props.channelId,
    () => props.fallbackName
  );
  return (
    <Show when={entity()}>
      {(seed) => (
        <HeaderActionGroup label="Agent actions">
          <ChatWithAgentButton
            grouped
            entity={seed()}
            label={t('entityActions.askMacro')}
          />
        </HeaderActionGroup>
      )}
    </Show>
  );
}
