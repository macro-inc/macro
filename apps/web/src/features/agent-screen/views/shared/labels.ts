import { t } from '@app/lib/i18n';
import type { DriverLabel } from '../../components/status-pill';

/** "Scout's desktop". */
export function screenTitle(agentName: string): string {
  return t('agentScreen.desktopTitle', { name: agentName });
}

export function driverLabel(
  drivingMe: boolean,
  drivingElsewhere: boolean,
  driverName: string | undefined
): DriverLabel | undefined {
  if (drivingMe) return { kind: 'me' };
  if (drivingElsewhere) return { kind: 'meElsewhere' };
  if (driverName !== undefined) return { kind: 'other', name: driverName };
  return undefined;
}
