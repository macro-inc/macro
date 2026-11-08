import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { isSameDay } from 'date-fns';
import { createSignal, Show, Suspense } from 'solid-js';
import { useCallAgain } from '../use-call-again';
import {
  CallRecordingAvatars,
  CallRecordingParticipantsSection,
} from './CallRecordingParticipants';

export function CallRecordingTitle(props: { record: CallRecord }) {
  const [participantsOpen, setParticipantsOpen] = createSignal(false);
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.record.callId,
    () => props.record.channelId
  );
  const dateRange = () => {
    const start = new Date(props.record.startedAt);
    const end = props.record.endedAt
      ? new Date(props.record.endedAt)
      : undefined;
    if (!Number.isFinite(start.getTime())) return '';
    const samePeriod =
      end &&
      isSameDay(start, end) &&
      start.getHours() < 12 === end.getHours() < 12;
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    const from = new Intl.DateTimeFormat(formatLocale(), options)
      .formatToParts(start)
      .filter((part) => !samePeriod || part.type !== 'dayPeriod')
      .map((part) => part.value)
      .join('')
      .trim();
    if (!end || !Number.isFinite(end.getTime())) return from;
    const endOptions = isSameDay(start, end)
      ? ({ hour: 'numeric', minute: '2-digit' } as const)
      : options;
    return `${from} – ${new Intl.DateTimeFormat(formatLocale(), endOptions).format(end)}`;
  };

  return (
    <header class="flex min-w-0 flex-col gap-1 @container/call-title">
      <Show when={props.record.channelName}>
        {(channel) => (
          <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
            <HashIcon class="size-4 shrink-0" />
            <span class="truncate">{channel()}</span>
          </div>
        )}
      </Show>
      <h1 class="text-2xl font-semibold tracking-tight text-ink text-balance">
        {props.record.customName ??
          props.record.channelName ??
          t('calls.detailFallbackName')}
      </h1>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
        <Show
          when={isMobile()}
          fallback={<CallRecordingAvatars record={props.record} />}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('calls.detailParticipants')}
            onClick={() => setParticipantsOpen(true)}
          >
            <CallRecordingAvatars record={props.record} suppressClick />
            <CaretRightIcon class="size-4" />
          </Button>
        </Show>
        <span class="mr-auto">{dateRange()}</span>
        <Show when={!isMobile() && !props.record.isActive && canCallAgain()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={callAgain}
            tooltip={t('calls.detailCallAgain')}
            aria-label={t('calls.detailCallAgain')}
          >
            <PhoneCallIcon class="size-4" />
            <span class="@max-[440px]/call-title:hidden">
              {t('calls.detailCallAgain')}
            </span>
          </Button>
        </Show>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <Suspense fallback={null}>
          <InlineFetchedEntityTagsPill
            entityId={props.record.callId}
            entityType="CALL_RECORD"
            showAddButton
          />
        </Suspense>
      </div>
      <MobileDrawer
        side="bottom"
        open={participantsOpen()}
        onOpenChange={setParticipantsOpen}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={t('calls.detailParticipants')}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <div class="p-5">
                <CallRecordingParticipantsSection record={props.record} />
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </header>
  );
}
