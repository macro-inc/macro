import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockId } from '@core/block';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import { ChannelTypeEnum } from '@service-comms/client';
import { createContext, createSignal, Show, useContext } from 'solid-js';
import type { ParentProps } from 'solid-js';
import { AttachmentsDrawer } from './AttachmentsModal';
import { ParticipantManagerDialog } from './ParticipantManager';
import { useChannelContext } from '@block-channel/hooks/channel';

type ChannelModalsContextValue = {
  openParticipants: () => void;
};

export const ChannelModalsContext = createContext<ChannelModalsContextValue>();

export function useChannelModals() {
  const ctx = useContext(ChannelModalsContext);
  if (!ctx)
    throw new Error('useChannelModals must be used within ModalsProvider');
  return ctx;
}

export function ModalsProvider(props: ParentProps) {
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const channelContext = useChannelContext();
  const [participantsOpen, setParticipantsOpen] = createSignal(false);

  return (
    <ChannelModalsContext.Provider
      value={{ openParticipants: () => setParticipantsOpen(true) }}
    >
      {props.children}
      <NotificationsDrawer
        entity={{ id: blockId, type: 'channel' }}
        notificationSource={notificationSource}
      />
      <AttachmentsDrawer />
      <Show
        when={channelContext.channelType() !== ChannelTypeEnum.DirectMessage}
      >
        <ParticipantManagerDialog
          open={participantsOpen()}
          onOpenChange={setParticipantsOpen}
        />
      </Show>
    </ChannelModalsContext.Provider>
  );
}
