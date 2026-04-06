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
import { useAnalytics } from '@app/component/analytics-context';
import { Tabs, type TabItem } from '@core/component/Tabs';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';

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

type ChannelTopLeftProps = TopProps & {
  lockRename?: boolean;
  tabs?: readonly TabItem[];
  activeTab?: ChannelTabId;
  onTabChange?: (value: ChannelTabId) => void;
};

export function ChannelTopLeft(props: ChannelTopLeftProps) {
  const blockId = useBlockId();
  const channelName = useChannelName(
    blockId,
    props.channelName ?? 'New Channel'
  );

  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex gap-3 justify-start items-center min-w-0">
        <div class="ph-no-capture z-3 relative flex items-center gap-2 max-w-full h-full shrink min-w-0">
          <TopIcon
            channelType={props.channelType}
            participants={props.participants}
          />
          <SplitLabel
            label={channelName() ?? 'New Channel'}
            id={props.channelId}
            itemType="channel"
            lockRename={props.lockRename}
          />
        </div>
        <Show when={props.tabs && props.activeTab && props.onTabChange}>
          <div class="ph-no-capture min-w-0 shrink-0 h-full">
            <Tabs
              list={[...(props.tabs ?? [])]}
              value={props.activeTab}
              onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
            />
          </div>
        </Show>
      </div>
    </SplitHeaderLeft>
  );
}

export function Top(props: TopProps) {
  const analytics = useAnalytics();

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
      buildSimpleEntityUrl({
        type: 'channel',
        id: blockId,
      })
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
          onOpenChange={(open) =>
            open &&
            analytics.track('notifications_panel_open', {
              blockType: 'channel',
            })
          }
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
      <ChannelTopLeft
        channelId={props.channelId}
        channelType={props.channelType}
        participants={props.participants}
        channelName={props.channelName}
        lockRename={
          props.channelType === ChannelTypeEnum.DirectMessage ||
          !isAdminOrOwner()
        }
      />

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
