import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@app/component/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { SplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  NotificationsButton,
  NOTIFICATIONS_DRAWER_ID,
} from '@core/component/NotificationsModal';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { buildSimpleEntityUrl } from '@core/util/url';
import Bell from '@icon/regular/bell.svg';
import HashIcon from '@icon/regular/hash.svg';
import LinkIcon from '@icon/regular/link.svg';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import UsersIcon from '@icon/regular/users.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { ChannelTypeEnum } from '@service-comms/client';
import { useUserId } from '@core/context/user';
import { createMemo, Show } from 'solid-js';
import { AttachmentsButton } from './AttachmentsModal';
import { useChannelContext } from '@block-channel/hooks/channel';
import { isChannelAdminOrOwner } from '@queries/channel/derived';
import { useChannelModals } from './ModalsProvider';
import { ParticipantManagerButton } from './ParticipantManager';

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
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const channelContext = useChannelContext();

  const notificationsControl = useDrawerControl(NOTIFICATIONS_DRAWER_ID);
  const attachmentsControl = useDrawerControl('attachments');
  const channelModals = useChannelModals();

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

  const tools: BlockTool[] = [
    {
      label: 'Copy Link',
      icon: LinkIcon,
      action: handleCopyLink,
      condition: () => props.channelType === ChannelTypeEnum.Public,
    },
    {
      label: 'Notifications',
      icon: Bell,
      action: notificationsControl.toggle,
      buttonComponent: () => (
        <NotificationsButton
          entity={{ id: blockId, type: 'channel' }}
          notificationSource={notificationSource}
        />
      ),
    },
    {
      label: 'Attachments',
      icon: PaperclipIcon,
      action: attachmentsControl.toggle,
      buttonComponent: () => (
        <AttachmentsButton attachments={channelModals.attachments} />
      ),
    },
    {
      label: 'Participants',
      icon: UsersIcon,
      action: () => channelModals.openParticipants(),
      condition: () => props.channelType !== ChannelTypeEnum.DirectMessage,
      buttonComponent: () => (
        <ParticipantManagerButton onClick={channelModals.openParticipants} />
      ),
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <div class="h-full my-auto flex gap-2 justify-start items-center">
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

      <ResponsiveBlockToolbar
        tools={tools}
        ops={[]}
        id={blockId}
        itemType="channel"
        name={channelName() ?? 'New Channel'}
      />
    </>
  );
}
