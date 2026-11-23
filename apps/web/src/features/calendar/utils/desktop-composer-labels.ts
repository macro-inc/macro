import { t } from '@app/lib/i18n';
import { minutesInDay, minutesInHour } from 'date-fns/constants';

/** Localized labels for the desktop composer's collapsed value rows. */
export function desktopGuestLabel(count: number) {
  return count === 0
    ? t('calendar.guestSummaryEmpty')
    : t('calendar.searchGuests', { count });
}

export function desktopReminderLabel(minutes: number[]) {
  return minutes
    .map((offset) => {
      if (offset === 0) return t('calendar.reminderAtStart');
      if (offset % (minutesInDay * 7) === 0)
        return t('calendar.reminderWeeksBefore', {
          count: offset / (minutesInDay * 7),
        });
      if (offset % minutesInDay === 0)
        return t('calendar.reminderDaysBefore', {
          count: offset / minutesInDay,
        });
      if (offset % minutesInHour === 0)
        return t('calendar.reminderHoursBefore', {
          count: offset / minutesInHour,
        });
      return t('calendar.reminderMinutesBefore', { count: offset });
    })
    .join(', ');
}
