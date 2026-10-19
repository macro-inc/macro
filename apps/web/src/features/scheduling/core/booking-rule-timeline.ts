/** Scale landmarks leave practical durations room without limiting exact inputs. */
export const NOTICE_TIMELINE = [0, 60, 1440, 10080] as const;
export const BUFFER_TIMELINE = [0, 30, 120, 1440, 10080] as const;
export const WINDOW_TIMELINE = [1, 365] as const;
export const BOOKING_RANGE_TIMELINE = [
  0, 60, 240, 720, 1440, 4320, 10080, 20160, 43200,
] as const;

/** Common notice increments retain precision near now and readable values farther ahead. */
function bookingNoticeStep(minutes: number): number {
  if (minutes < 120) return 15;
  if (minutes < 240) return 30;
  if (minutes < 1440) return 60;
  return 1440;
}

export function snapBookingNotice(minutes: number): number {
  const step = bookingNoticeStep(minutes);
  return Math.round(minutes / step) * step;
}

/** Use the previous increment at boundaries so keyboard steps work in both directions. */
export function bookingNoticeTick(minutes: number, direction: number): number {
  const step = bookingNoticeStep(
    Math.max(0, minutes + (direction < 0 ? -1 : 0))
  );
  return direction > 0
    ? (Math.floor(minutes / step) + 1) * step
    : (Math.ceil(minutes / step) - 1) * step;
}

/** Map stored values onto equally spaced, explicitly labelled scale landmarks. */
export function bookingTimelinePosition(
  value: number,
  landmarks: readonly number[]
): number {
  if (!Number.isFinite(value) || value <= landmarks[0]) return 0;
  const last = landmarks.length - 1;
  if (value >= landmarks[last]) return 100;
  const index = landmarks.findIndex((landmark) => landmark > value) - 1;
  const fraction =
    (value - landmarks[index]) / (landmarks[index + 1] - landmarks[index]);
  return ((index + fraction) / last) * 100;
}

/** Only a slider gesture rounds a scaled position to a stored whole value. */
export function bookingTimelineValue(
  position: number,
  landmarks: readonly number[]
): number {
  const last = landmarks.length - 1;
  const scaled = (Math.min(100, Math.max(0, position)) / 100) * last;
  const index = Math.min(last - 1, Math.floor(scaled));
  return Math.round(
    landmarks[index] +
      (scaled - index) * (landmarks[index + 1] - landmarks[index])
  );
}
