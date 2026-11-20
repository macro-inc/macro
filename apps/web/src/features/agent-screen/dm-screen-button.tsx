import { t } from '@app/lib/i18n';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { useChannel, useChannelType } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { type Accessor, Show } from 'solid-js';
import {
  useAgentScreenHarnessId,
  useOpenAgentScreen,
} from './screen-user-action';

/**
 * The computer to offer in a DM's header: the harness of the other
 * participant when they are an agent teammate (a user whose computer names
 * them as `team_agent_user_id`) whose screen the viewer may watch. Works for
 * a team agent's ordinary DM and for a bot DM alike; `undefined` in any other
 * conversation.
 */
export function useDmScreenHarnessId(
  channelId: Accessor<string>
): Accessor<string | undefined> {
  const userId = useUserId();
  const participants = useChannelParticipants(channelId);
  const otherParticipant = () => {
    const ids = participants.ids();
    if (ids.length !== 2) return undefined;
    return ids.find((id) => id !== userId());
  };
  return useAgentScreenHarnessId(otherParticipant);
}

/** Screen, in the header of a DM with an agent teammate (`useDmScreenHarnessId`). */
export function DmScreenButton(props: {
  harnessId: string;
  grouped?: boolean;
}) {
  const openScreen = useOpenAgentScreen();
  return (
    <HeaderActionButton
      grouped={props.grouped}
      label={t('agentScreen.screen')}
      tooltip={t('agentScreen.viewScreen')}
      onClick={() => openScreen(props.harnessId)}
      icon={
        <DesktopIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
      }
    />
  );
}

/**
 * The DM header's Screen on touch: its own header island, shown only in an
 * agent teammate's DM. Both touch headers (the channel detail's and the
 * channel block's) render it.
 */
export function DmScreenIsland(props: { channelId: string }) {
  const channelType = useChannelType(props.channelId);
  const channel = useChannel(props.channelId);
  // Other conversations never look their participants up for it.
  const harnessId = useDmScreenHarnessId(() =>
    channelType() === ChannelType.direct_message || channel()?.agent_dm
      ? props.channelId
      : ''
  );
  return (
    <Show when={harnessId()}>
      {(id) => (
        <HeaderIsland class="px-1">
          <DmScreenButton harnessId={id()} />
        </HeaderIsland>
      )}
    </Show>
  );
}
