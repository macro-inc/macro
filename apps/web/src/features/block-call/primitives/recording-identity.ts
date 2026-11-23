import { formatLocale, t } from '@app/lib/i18n';
import { guestDisplayName } from '@channel/Call/call-identity';
import { getDisplayName, tryMacroId } from '@core/user';
import type { CallRecord } from '@service-call/client';
import { isSameDay } from 'date-fns';
import type { Accessor } from 'solid-js';

export function recordingName(record: CallRecord) {
  return (
    record.customName ?? record.channelName ?? t('calls.detailFallbackName')
  );
}

/** Shared recording identity for the title, header and compact playback surfaces. */
export function createRecordingIdentity(
  record: Accessor<CallRecord>,
  activeSequenceNum?: Accessor<number | null | undefined>
) {
  const title = () => recordingName(record());
  const dateRange = () => {
    const start = new Date(record().startedAt);
    const endedAt = record().endedAt;
    const end = endedAt ? new Date(endedAt) : undefined;
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
  const currentSpeaker = () => {
    const segment = record().transcript.find(
      (item) => item.sequenceNum === activeSequenceNum?.()
    );
    if (!segment) return title();
    return (
      guestDisplayName(record(), segment.speakerId) ||
      getDisplayName(tryMacroId(segment.speakerId))
    );
  };
  return { title, dateRange, currentSpeaker };
}
