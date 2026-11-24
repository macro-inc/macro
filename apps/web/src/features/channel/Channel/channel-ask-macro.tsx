import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useChannel } from '@core/context/channels';
import { type Accessor, Show } from 'solid-js';

/**
 * Seed for "Ask Macro": a new chat with this channel @mentioned, so the user
 * does not have to create an agent and mention the channel by hand.
 * `fallbackName` names a channel that has no name of its own.
 */
export function useChannelAskMacroEntity(
  channelId: Accessor<string>,
  fallbackName?: Accessor<string | undefined>
) {
  const channel = useChannel(channelId);
  return () => {
    const current = channel();
    if (!current) return undefined;
    return {
      type: 'channel' as const,
      id: current.id,
      name: current.name ?? fallbackName?.() ?? 'New Channel',
      channelType: current.channelType,
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
    () => props.channelId,
    () => props.fallbackName
  );
  return (
    <Show when={entity()}>
      {(seed) => (
        <HeaderActionGroup label={t('entityActions.agentActions')}>
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
