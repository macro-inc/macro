import { t } from '@app/lib/i18n';
import type { DriverLabel } from '../../components/status-pill';

/** "Scout's desktop". */
export function screenTitle(agentName: string): string {
  return t('agentScreen.desktopTitle', { name: agentName });
}

/**
 * What the agent does while someone drives: paused only when the server says
 * it holds the agent (`agentHeld`); otherwise it is still working on the
 * same desktop, and the viewer says so rather than promise a pause.
 */
export function agentWhileDriven(
  agentHeld: boolean,
  agentName: string
): string {
  return agentHeld
    ? t('agentScreen.agentPaused', { name: agentName })
    : t('agentScreen.agentStillWorking', { name: agentName });
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
