import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { UserGroup } from '@core/component/UserGroup';
import { useActiveCallQuery, useLiveCallRecordQuery } from '@queries/call/call';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { ActiveCallLink } from './ActiveCallLink';
import { CallLiveChip } from './CallLiveChip';
import { getCallJoinTab } from './call-tabs';
import { PhoneAudioOutput } from './PhoneAudioOutput';
import { useParticipantSpeaking } from './use-call-speaking';

function CallHeaderPill(props: { channelId: string; startedAt?: string }) {
  const { setActiveTab } = useChannelTab();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('calls.openCall')}
      tooltip={t('calls.openCall')}
      onClick={() => {
        const interaction = beginInteraction('call.header.open');
        try {
          setActiveTab(getCallJoinTab());
        } finally {
          interaction.end();
        }
      }}
    >
      <CallLiveChip
        live
        bare
        channelId={props.channelId}
        startedAt={props.startedAt}
      />
    </Button>
  );
}

/** The channel owns its header; the call adds only its live state and link. */
export function ActiveCallHeader(props: { channelId: string; link?: boolean }) {
  const active = useActiveCallQuery(() => props.channelId);
  return (
    <>
      <PhoneAudioOutput />
      <CallHeaderPill
        channelId={props.channelId}
        startedAt={active.isSuccess ? active.data?.createdAt : undefined}
      />
      <Show when={props.link}>
        <ActiveCallLink compact />
      </Show>
    </>
  );
}

export function JoinableCallStatus(props: { channelId: string }) {
  const active = useActiveCallQuery(() => props.channelId);
  const record = useLiveCallRecordQuery(() =>
    active.isSuccess ? (active.data?.callId ?? '') : ''
  );
  const isSpeaking = useParticipantSpeaking(() => ({
    channelId: props.channelId,
  }));
  const participants = () =>
    record.isSuccess
      ? record.data.participants
          .filter((person) => !person.leftAt)
          .map((person) => person.userId)
      : [];
  return (
    <Show when={active.isSuccess && active.data}>
      <UserGroup
        isHighlighted={isSpeaking}
        userIds={participants()}
        size="sm"
        maxUsers={4}
        suppressClick
      />
      <CallHeaderPill
        channelId={props.channelId}
        startedAt={active.isSuccess ? active.data?.createdAt : undefined}
      />
    </Show>
  );
}
