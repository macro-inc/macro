import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useLiveCallRecordQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { useCallContextOptional } from './CallContext';
import { CallLiveChip } from './CallLiveChip';
import { CallQuickControls } from './CallQuickControls';
import { useActiveCallCompanion } from './use-active-call-companion';

export function MobileCallIsland() {
  const call = useCallContextOptional();
  const companion = useActiveCallCompanion();
  const visible = () =>
    isMobile() &&
    !!call?.isInCall() &&
    !companion.inCallView() &&
    !virtualKeyboardVisible();
  const record = useLiveCallRecordQuery(() =>
    visible() ? (call?.activeCallId() ?? '') : ''
  );
  const speaker = () => {
    if (call?.isLocalSpeaking()) return undefined;
    const participants = Array.from(call?.remoteParticipants().values() ?? []);
    return (
      participants.find((participant) =>
        call?.isParticipantSpeaking(participant)
      ) ?? participants[0]
    );
  };
  const name = () => {
    const participant = speaker();
    return (
      participant?.name?.trim() ||
      getDisplayName(tryMacroId(participant?.identity ?? '')) ||
      t('calls.you')
    );
  };
  const speaking = () =>
    call?.isLocalSpeaking() ||
    !!(speaker() && call?.isParticipantSpeaking(speaker()!));
  const open = () => fireAndForget(companion.open(), 'mobile-call-island');
  return (
    <FloatRegion region="call" active={visible}>
      <Show when={visible()}>
        <div class="px-(--mobile-chrome-gutter) pointer-events-auto">
          <div class="island flex items-center gap-2 rounded-full p-1.5">
            <Button
              variant="ghost"
              size="md"
              class="min-w-0 flex-1 justify-start"
              aria-label={t('nav.returnToCall')}
              onClick={open}
            >
              <span
                class={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-extra-muted text-surface',
                  speaking() && 'ring-2 ring-success'
                )}
              >
                {name().charAt(0).toUpperCase()}
              </span>
              <span class="min-w-0 text-left">
                <span class="block truncate text-sm">
                  {record.isSuccess
                    ? record.data.channelName || t('nav.returnToCall')
                    : t('nav.returnToCall')}
                </span>
                <CallLiveChip
                  callId={call?.activeCallId() ?? undefined}
                  bare
                  hideWave
                  startedAt={
                    record.isSuccess ? record.data.startedAt : undefined
                  }
                />
              </span>
            </Button>
            <CallQuickControls controls={[]} size="icon-lg" />
          </div>
        </div>
      </Show>
    </FloatRegion>
  );
}
