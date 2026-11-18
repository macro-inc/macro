import { formatLocale } from '@app/lib/i18n';

/** "1.8" from bytes: one decimal under 10 GB, none above. */
export function formatMemoryGb(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib.toLocaleString(formatLocale(), {
    maximumFractionDigits: gib < 10 ? 1 : 0,
  });
}
