import type { CurrentSystemStatus } from '@queries/system-status/status';
import { match } from 'ts-pattern';

export type StatusLevel = 'operational' | 'degraded' | 'major_outage';

/** A status that shows a banner. */
export type BannerStatus = {
  level: Exclude<StatusLevel, 'operational'>;
  message: string;
};

export const STATUS_LEVELS: readonly StatusLevel[] = [
  'operational',
  'degraded',
  'major_outage',
];

export const STATUS_LABELS: Record<StatusLevel, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  major_outage: 'Major outage',
};

export const MAX_MESSAGE_LENGTH = 500;

/** The banner to show for `status`, or nothing while operational. */
export function bannerStatus(
  status: CurrentSystemStatus
): BannerStatus | undefined {
  return match(status)
    .with({ status: 'operational' }, () => undefined)
    .with({ status: 'degraded' }, { status: 'major_outage' }, (s) => ({
      level: s.status,
      message: s.message,
    }))
    .exhaustive();
}
