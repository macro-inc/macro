import type { WheelOption } from '../app/mobile/wheel-picker/wheel-values';

export const TIME_WHEEL_MINUTE_STEP = 5;

/** Keep both half-days in the hour cycle so crossing eleven carries the period. */
export function timeWheelHours(twelveHour: boolean): WheelOption[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour);
    const label = twelveHour ? String(hour % 12 || 12) : value.padStart(2, '0');
    return { value, label };
  });
}

/** Preserve one off-step synced minute until a minute-wheel selection replaces it. */
export function timeWheelMinutes(currentMinute: number): WheelOption[] {
  const minutes = Array.from(
    { length: 60 / TIME_WHEEL_MINUTE_STEP },
    (_, index) => index * TIME_WHEEL_MINUTE_STEP
  );
  if (currentMinute % TIME_WHEEL_MINUTE_STEP !== 0) minutes.push(currentMinute);
  return minutes
    .sort((left, right) => left - right)
    .map((minute) => ({
      value: String(minute),
      label: String(minute).padStart(2, '0'),
    }));
}

export function timeWheelParts(value: string) {
  const hours = Number(value.slice(0, 2));
  return {
    hour: String(hours),
    minute: String(Number(value.slice(3, 5))),
    period: hours < 12 ? 'am' : 'pm',
  };
}

export function timeFromWheelParts(
  parts: { hour: string; minute: string; period: string },
  twelveHour: boolean
) {
  let hour = Number(parts.hour);
  if (twelveHour) hour = (hour % 12) + (parts.period === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${parts.minute.padStart(2, '0')}`;
}
