import { formatLocale } from '@app/lib/i18n';
import type { ComputerUsage } from '@service-auth/computers';

/** "1.8" from bytes: one decimal under 10 GB, none above. */
export function formatMemoryGb(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib.toLocaleString(formatLocale(), {
    maximumFractionDigits: gib < 10 ? 1 : 0,
  });
}

/**
 * Whether a computer has a reading in the last day. One with none (setting
 * up, failed, or on a host that reports no usage yet) gets no usage line,
 * so it never reads as idle.
 */
export function hasReadings(usage: ComputerUsage): boolean {
  return usage.latest != null || usage.points.some((point) => point != null);
}
