import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { SplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { NotificationsModal } from '@core/component/NotificationsModal';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { buildSimpleEntityUrl } from '@core/util/url';
import HashIcon from '@icon/regular/hash.svg';
import LinkIcon from '@icon/regular/link.svg';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { ChannelTypeEnum } from '@service-comms/client';
import { useUserId } from '@core/context/user';
import { createMemo, Show } from 'solid-js';
import { AttachmentsModal } from './AttachmentsModal';
import { ParticipantManager } from './ParticipantManager';
import { useChannelContext } from '@block-channel/hooks/channel';
import { isChannelAdminOrOwner } from '@queries/channel/derived';

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
      when={props.channelType === ChannelTypeEnum.DirectMessage && recipient()}
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

type TopProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
  channelName: string;
  channelId: string;
};

export function Top(props: TopProps) {
  const participantCount = () => props.participants.length;
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const channelContext = useChannelContext();

  const isAdminOrOwner = createMemo(() => {
    const channelData = channelContext.channel();
    return isChannelAdminOrOwner(channelData);
  });

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
    props.channelName ?? 'New Channel'
  );

  return (
    <>
      <SplitHeaderLeft>
        <div class="h-full my-auto flex gap-2 justify-center items-center">
          <div class="z-3 relative flex items-center gap-2 max-w-full h-full shrink">
            <TopIcon
              channelType={props.channelType}
              participants={props.participants}
            />
            <SplitLabel
              label={channelName() ?? 'New Channel'}
              id={props.channelId}
              itemType="channel"
              lockRename={
                props.channelType === ChannelTypeEnum.DirectMessage ||
                !isAdminOrOwner()
              }
            />
          </div>
        </div>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
      </SplitHeaderRight>
      <SplitToolbarRight>
        <div class="p-1 flex flex-row gap-1 items-center h-full">
          <Show when={props.channelType === ChannelTypeEnum.Public}>
            <DeprecatedIconButton
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
          <Show when={props.channelType !== ChannelTypeEnum.DirectMessage}>
            <ParticipantManager
              channelId={props.channelId}
              channelType={props.channelType}
              participants={props.participants}
              participantCount={participantCount()}
            />
          </Show>
        </div>
      </SplitToolbarRight>
    </>
  );
}
