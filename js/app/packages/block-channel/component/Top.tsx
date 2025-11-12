import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import { channelStore } from '@block-channel/signal/channel';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/component/ChannelsProvider';
import { IconButton } from '@core/component/IconButton';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsModal } from '@core/component/NotificationsModal';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { buildSimpleEntityUrl } from '@core/util/url';
import HashIcon from '@icon/regular/hash.svg';
import LinkIcon from '@icon/regular/link.svg';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { useUserId } from '@service-gql/client';
import { Show } from 'solid-js';
import { AttachmentsModal } from './AttachmentsModal';
import { ParticipantManager } from './ParticipantManager';

type TopIconProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
};

function TopIcon(props: TopIconProps) {
  const userId = useUserId();
  const recipient = () => {
    return props.participants.find((p) => p && p.user_id !== userId());
  };

  return (
    <Show
      when={props.channelType === 'direct_message' && recipient()}
      fallback={<HashIcon class="w-4 h-4" />}
    >
      {(recipient) => {
        return (
          <UserIcon id={recipient().user_id} isDeleted={false} size="xs" />
        );
      }}
    </Show>
  );
}

export function Top() {
  const channel = channelStore.get;
  const channelType = () => channel?.channel?.channel_type ?? 'private';
  const participantCount = () => channel?.participants.length ?? 0;
  const participants = () => channel?.participants ?? [];
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();

  function handleCopyLink() {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl(
        {
          type: 'channel',
          id: blockId,
        },
        {}
      )
    );
    toast.success('Link copied to clipboard');
  }
  const channelName = useChannelName(
    blockId,
    channel?.channel?.name ?? 'New Channel'
  );

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={channelName() ?? 'New Channel'}
          icon={
            <TopIcon
              channelType={channelType()}
              participants={participants()}
            />
          }
        />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="flex h-full">
          <EntityNavigationIndicator />
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <SplitToolbarRight>
        <div class="p-1 flex flex-row gap-1 items-center h-full">
          <Show when={channelType() === 'public'}>
            <IconButton
              theme="clear"
              size="sm"
              tooltip={{ label: 'Copy Link to Public Channel' }}
              icon={LinkIcon}
              onClick={handleCopyLink}
            />
          </Show>
          <NotificationsModal
            entity={{ id: blockId, type: 'channel' }}
            notificationSource={notificationSource}
            buttonSize="sm"
          />
          <AttachmentsModal />
          <Show when={channelType() !== 'direct_message'}>
            <ParticipantManager participantCount={participantCount()} />
          </Show>
        </div>
      </SplitToolbarRight>
    </>
  );
}
