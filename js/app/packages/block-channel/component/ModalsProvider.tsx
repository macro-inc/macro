import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockId } from '@core/block';
import { NotificationsDrawer } from '@core/component/NotificationsModal';
import { ChannelTypeEnum } from '@service-comms/client';
import { createContext, createSignal, Show, useContext } from 'solid-js';
import type { ParentProps } from 'solid-js';
import { AttachmentsDrawer, useAttachments } from './AttachmentsModal';
import type { Attachment } from '@queries/channel/types';
import { ParticipantManagerDialog } from './ParticipantManager';
import { useChannelContext } from '@block-channel/hooks/channel';
import { CallProvider, CallOverlay, useCall } from '@channel/Call';
import { useSendTranscriptMutation } from '@queries/call/call';

type ChannelModalsContextValue = {
  openParticipants: () => void;
  attachments: () => Attachment[];
  joinCall: () => Promise<void>;
  leaveCall: () => Promise<void>;
  isInCall: () => boolean;
};

export const ChannelModalsContext = createContext<ChannelModalsContextValue>();

export function useChannelModals() {
  const ctx = useContext(ChannelModalsContext);
  if (!ctx)
    throw new Error('useChannelModals must be used within ModalsProvider');
  return ctx;
}

export function ModalsProvider(props: ParentProps) {
  return (
    <CallProvider>
      <ModalsProviderInner>{props.children}</ModalsProviderInner>
    </CallProvider>
  );
}

function ModalsProviderInner(props: ParentProps) {
  const blockId = useBlockId();
  const notificationSource = useGlobalNotificationSource();
  const channelContext = useChannelContext();
  const [participantsOpen, setParticipantsOpen] = createSignal(false);
  const attachments = useAttachments();
  const call = useCall(() => blockId);
  const sendTranscript = useSendTranscriptMutation();

  // Forward final transcript segments to the backend
  call.callCtx.onTranscriptSegment((segment) => {
    sendTranscript.mutate({
      channelId: blockId,
      segment: {
        segmentId: segment.id,
        speakerId: segment.participantIdentity,
        content: segment.text,
        startedAt: new Date().toISOString(),
        isFinal: segment.isFinal,
      },
    });
  });

  return (
    <ChannelModalsContext.Provider
      value={{
        openParticipants: () => setParticipantsOpen(true),
        attachments,
        joinCall: call.joinCall,
        leaveCall: call.leaveCall,
        isInCall: call.isInThisChannel,
      }}
    >
      <Show when={call.isInThisChannel()} fallback={props.children}>
        <div class="flex flex-col h-full">
          <div class="flex-1 min-h-0">{props.children}</div>
          <div class="h-[300px] shrink-0 border-t border-edge">
            <CallOverlay onLeave={call.leaveCall} />
          </div>
        </div>
      </Show>
      <NotificationsDrawer
        entity={{ id: blockId, type: 'channel' }}
        notificationSource={notificationSource}
      />
      <AttachmentsDrawer attachments={attachments} />
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
