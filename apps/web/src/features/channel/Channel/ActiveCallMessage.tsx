import { analytics } from '@app/lib/analytics';
import { t } from '@app/lib/i18n';
import { getCallJoinTab } from '@channel/Call/call-tabs';
import { useCall } from '@channel/Call/use-call';
import { UserGroup } from '@core/component/UserGroup';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { useActiveCallQuery, useLiveCallRecordQuery } from '@queries/call/call';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { CallLiveChip } from '../Call/components/CallLiveChip';
import { CallWaveform } from '../Call/components/CallWaveform';
import { openChannelCallTab } from '../Call/open-channel-call-tab';
import { useParticipantSpeaking } from '../Call/primitives/use-call-speaking';
import { useChannelTab } from './ChannelTabContext';

export function ActiveCallMessage(props: { channelId: string }) {
  const active = useActiveCallQuery(() => props.channelId);
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
  });
  const record = useLiveCallRecordQuery(() => {
    if (call.isInThisChannel()) return call.callCtx.activeCallId() ?? '';
    return active.isSuccess ? (active.data?.callId ?? '') : '';
  });
  const isSpeaking = useParticipantSpeaking(() => ({
    channelId: props.channelId,
  }));
  const participantIds = () =>
    record.isSuccess
      ? record.data.participants
          .filter((participant) => !participant.leftAt)
          .map((participant) => participant.userId)
      : [];

  const showBanner = () => {
    if (call.isInThisChannel()) return isMobile();
    return active.isSuccess && !!active.data;
  };
  const startedAt = () => {
    if (active.isSuccess && active.data) return active.data.createdAt;
    if (record.isSuccess) return record.data.startedAt;
    return undefined;
  };
  async function handleJoin() {
    if (call.isInThisChannel()) {
      await openChannelCallTab(props.channelId);
      return;
    }
    analytics.track('call_action', {
      action: 'join_clicked',
      channelId: props.channelId,
      isExistingCall: true,
    });
    await call.joinCall('user', {
      kind: 'join',
      callId: active.data?.callId,
    });
  }

  return (
    <Show when={showBanner()}>
      <div class="mb-2 flex w-full justify-center touch:px-(--mobile-chrome-gutter) touch:pointer-events-auto">
        <div class="macro-message-width w-full min-w-0 rounded-2xl bg-surface">
          <div class="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-success/20 bg-success/10 p-2.5">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10">
              <CallWaveform class="size-5" />
            </span>
            <div class="flex min-w-0 flex-1 items-center gap-2 mobile:flex-col mobile:items-start mobile:gap-0">
              <span class="truncate text-sm font-medium">
                {t('calls.inProgress')}
              </span>
              <CallLiveChip bare hideWave startedAt={startedAt()} />
            </div>
            <UserGroup
              isHighlighted={isSpeaking}
              userIds={participantIds()}
              maxUsers={isMobile() ? 3 : 4}
              size="sm"
              suppressClick
            />
            <Button
              variant="success"
              size="sm"
              disabled={call.isJoining()}
              onClick={() => fireAndForget(handleJoin(), 'channel-call')}
            >
              <PhoneIcon class="size-4" />
              {call.isInThisChannel() ? t('nav.returnToCall') : t('calls.join')}
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
