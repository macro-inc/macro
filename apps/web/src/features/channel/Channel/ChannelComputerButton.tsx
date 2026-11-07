import { AgentComputerScreenEntry } from '@app/features/computer-screen/agent-computer-screen-entry';
import { t } from '@app/lib/i18n';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { useChannel } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { Show } from 'solid-js';

/** A DM's existing computer opens in watch mode; the Screen pane owns control. */
export function ChannelComputerButton(props: {
  channelId: string;
  grouped?: boolean;
}) {
  const channel = useChannel(props.channelId);
  const viewer = useUserId();
  const account = () => {
    const dm = channel();
    const viewerId = viewer();
    if (!viewerId || dm?.channel_type !== ChannelType.direct_message) return;
    if (dm.agent_dm) return `bot|${dm.agent_dm.bot_id}`;
    const others = dm.participants.filter(
      (person) => person.user_id !== viewerId
    );
    return others.length === 1 ? others[0].user_id : undefined;
  };
  return (
    <AgentComputerScreenEntry userId={account()}>
      {(harness, open) => (
        <Show when={harness() && harness()?.access !== 'none'}>
          <HeaderActionButton
            grouped={props.grouped}
            size="icon-sm"
            label={t('runtimeSharing.viewComputer')}
            tooltip={t('runtimeSharing.viewComputer')}
            icon={
              <DesktopIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            }
            onClick={() => {
              const machine = harness();
              if (machine && machine.access !== 'none') open(false);
            }}
          />
        </Show>
      )}
    </AgentComputerScreenEntry>
  );
}
